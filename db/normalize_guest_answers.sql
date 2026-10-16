-- Canonicalization only. Personal answers are set separately in the private database.
create or replace function diary_private.normalize_guest_answer(p_question integer,p_answer text)
returns text language plpgsql immutable security invoker set search_path='' as $$
declare v text; parts text[]; day_value integer; month_value integer; year_value integer; date_value date;
begin
  if p_answer is null or pg_catalog.length(p_answer)>200 then return null; end if;
  v := pg_catalog.lower(pg_catalog.normalize(p_answer,'NFKC'));
  if p_question=3 then
    v := pg_catalog.regexp_replace(v,'[[:space:][:punct:]]','','g');
    return nullif(v,'');
  end if;
  if p_question not in (1,2) then return null; end if;
  -- Uzbek, English and Russian June forms; separators and optional year labels vary.
  v := pg_catalog.regexp_replace(v,'iyun|june|июня|июнь',' 6 ','g');
  v := pg_catalog.regexp_replace(v,'yili?|years?|года?',' ','g');
  if v ~ '[[:alpha:]]' then return null; end if;
  v := pg_catalog.btrim(pg_catalog.regexp_replace(v,'[^0-9]+',' ','g'));
  if v ~ '^[0-9]{8}$' then
    if pg_catalog.substring(v,1,4)::integer between 1900 and 2199 then
      parts := array[pg_catalog.substring(v,1,4),pg_catalog.substring(v,5,2),pg_catalog.substring(v,7,2)];
    else
      parts := array[pg_catalog.substring(v,1,2),pg_catalog.substring(v,3,2),pg_catalog.substring(v,5,4)];
    end if;
  else parts := pg_catalog.regexp_split_to_array(v,' +'); end if;
  if pg_catalog.cardinality(parts)<>3 then return null; end if;
  if pg_catalog.length(parts[1])=4 then
    year_value := parts[1]::integer; month_value := parts[2]::integer; day_value := parts[3]::integer;
  elsif pg_catalog.length(parts[3])=4 then
    day_value := parts[1]::integer; month_value := parts[2]::integer; year_value := parts[3]::integer;
    -- An unambiguous US numeric date (month/day/year) is accepted too.
    if month_value>12 and day_value between 1 and 12 then
      month_value := parts[1]::integer; day_value := parts[2]::integer;
    end if;
  else return null; end if;
  if year_value not between 1900 and 2199 then return null; end if;
  date_value := pg_catalog.make_date(year_value,month_value,day_value);
  return pg_catalog.to_char(date_value,'YYYY-MM-DD');
exception when datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range then
  return null;
end;
$$;
revoke all on function diary_private.normalize_guest_answer(integer,text) from public,anon,authenticated;

create or replace function public.read_private_diary_verified(p_alias text,p_code text,p_answers text[],p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid; v_hash bytea; v_attempt diary_private.guest_answer_attempts%rowtype;
  v_question record; v_ok boolean := true; v_count integer := 0;
  v_answer text; v_items jsonb; v_more boolean;
begin
  if p_offset is null or p_offset<0 or p_offset>1000000 then
    return pg_catalog.jsonb_build_object('status','invalid_request');
  end if;
  v_owner := diary_private.guest_owner(p_alias,p_code);
  if v_owner is null then return pg_catalog.jsonb_build_object('status','invalid_code'); end if;
  v_hash := pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(p_code),'UTF8'));
  -- One bounded row per owner; code rotation resets its attempt window.
  insert into diary_private.guest_answer_attempts(owner_id,code_hash) values(v_owner,v_hash)
    on conflict(owner_id) do nothing;
  select * into v_attempt from diary_private.guest_answer_attempts where owner_id=v_owner for update;
  if v_attempt.code_hash=v_hash and v_attempt.blocked_until>pg_catalog.now() then
    return pg_catalog.jsonb_build_object('status','blocked','blocked_until',v_attempt.blocked_until);
  end if;
  if v_attempt.code_hash<>v_hash or v_attempt.window_started_at<=pg_catalog.now()-interval '15 minutes' then
    update diary_private.guest_answer_attempts set code_hash=v_hash,failed_attempts=0,
      window_started_at=pg_catalog.now(),blocked_until=null where owner_id=v_owner returning * into v_attempt;
  end if;
  if v_attempt.blocked_until>pg_catalog.now() then
    return pg_catalog.jsonb_build_object('status','blocked','blocked_until',v_attempt.blocked_until);
  end if;
  if p_answers is null or pg_catalog.array_ndims(p_answers)<>1 or pg_catalog.cardinality(p_answers)<>3
    or pg_catalog.array_lower(p_answers,1)<>1 then v_ok := false; end if;
  for v_question in select question_number,answer_hash from public.diary_questions
    where question_number between 1 and 3 order by question_number
  loop
    v_count := v_count+1;
    v_answer := p_answers[v_question.question_number];
    if v_answer is null or pg_catalog.length(v_answer)<1 or pg_catalog.length(v_answer)>200 then
      v_ok := false;
    else
      -- Accept canonical equivalent dates/names and preserve legacy SHA-256 compatibility.
      if v_question.answer_hash is null or v_question.answer_hash !~ '^[0-9a-f]{64}$' or v_question.answer_hash not in (
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(v_answer)),'UTF8')),'hex'),
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(v_answer),'UTF8')),'hex'),
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(diary_private.normalize_guest_answer(v_question.question_number,v_answer),''),'UTF8')),'hex')
      ) then v_ok := false; end if;
    end if;
  end loop;
  if v_count<>3 or (select pg_catalog.count(distinct question_number) from public.diary_questions where question_number between 1 and 3)<>3 then return pg_catalog.jsonb_build_object('status','not_configured'); end if;
  if not v_ok then
    update diary_private.guest_answer_attempts set failed_attempts=least(failed_attempts+1,5),
      blocked_until=case when failed_attempts+1>=5 then pg_catalog.now()+interval '24 hours' else null end
      where owner_id=v_owner returning * into v_attempt;
    -- Return instead of raising: failed attempts must commit even when verification fails.
    return pg_catalog.jsonb_build_object('status',case when v_attempt.blocked_until is not null then 'blocked' else 'invalid_answers' end,
      'attempts_remaining',5-v_attempt.failed_attempts,'blocked_until',v_attempt.blocked_until);
  end if;
  update diary_private.guest_answer_attempts set failed_attempts=0,window_started_at=pg_catalog.now(),blocked_until=null where owner_id=v_owner;
  with page as (
    select d.entry_date,d.title,d.content,d.created_at,d.id from public.diary_entries d where d.user_id=v_owner
    order by d.entry_date desc,d.created_at desc,d.id desc offset p_offset limit 501
  ), items as (
    select * from page order by entry_date desc,created_at desc,id desc limit 500
  )
  select coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('entry_date',i.entry_date,'title',i.title,'content',i.content)
    order by i.entry_date desc,i.created_at desc,i.id desc) from items i),'[]'::jsonb),
    (select pg_catalog.count(*)>500 from page) into v_items,v_more;
  return pg_catalog.jsonb_build_object('status','ok','entries',v_items,'has_more',v_more,'next_offset',p_offset+500);
end;
$$;