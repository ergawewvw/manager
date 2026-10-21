-- Comments are private to the diary owner and readers who pass the existing gate.
create table diary_private.entry_comments (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  entry_id bigint not null references public.diary_entries(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 60),
  body text not null check (char_length(body) between 1 and 2000),
  request_id uuid not null unique,
  created_at timestamptz not null default now()
);
alter table diary_private.entry_comments enable row level security;
revoke all on diary_private.entry_comments from public,anon,authenticated;
revoke all on sequence diary_private.entry_comments_id_seq from public,anon,authenticated;
create index entry_comments_entry_page_idx on diary_private.entry_comments(entry_id,id desc);
create index entry_comments_owner_recent_idx on diary_private.entry_comments(owner_id,created_at desc);

create function diary_private.comment_page(p_entry_id bigint,p_before_id bigint)
returns jsonb language sql stable security invoker set search_path='' as $$
  with page as (
    select c.* from diary_private.entry_comments c
    where c.entry_id=p_entry_id and (p_before_id is null or c.id<p_before_id)
    order by c.id desc limit 21
  ), items as (select * from page order by id desc limit 20)
  select jsonb_build_object('status','ok','comments',coalesce((
    select jsonb_agg(jsonb_build_object('id',id::text,'name',display_name,'body',body,'created_at',created_at) order by id desc) from items
  ),'[]'::jsonb),'has_more',(select count(*)>20 from page));
$$;
revoke all on function diary_private.comment_page(bigint,bigint) from public,anon,authenticated;

create function diary_private.insert_comment(p_owner uuid,p_entry_id bigint,p_name text,p_body text,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_name text:=btrim(regexp_replace(p_name,'[[:space:]]+',' ','g')); v_body text:=btrim(p_body);
  v_row diary_private.entry_comments%rowtype; v_total integer; v_named integer;
begin
  if p_request_id is null or v_name is null or char_length(v_name) not between 2 and 60
    or char_length(regexp_replace(v_name,'[^[:alpha:]]','','g'))<2 or v_name ~ '[[:cntrl:]<>]'
    or v_body is null or char_length(v_body) not between 1 and 2000 then
    return jsonb_build_object('status','invalid_input');
  end if;
  if p_owner is null or not exists(select 1 from public.diary_entries where id=p_entry_id and user_id=p_owner) then
    return jsonb_build_object('status','not_found');
  end if;
  -- Serialize one diary's writers so parallel requests cannot bypass rate limits.
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,719));
  select * into v_row from diary_private.entry_comments where request_id=p_request_id;
  if found then
    if v_row.owner_id<>p_owner or v_row.entry_id<>p_entry_id or v_row.display_name<>v_name or v_row.body<>v_body then
      return jsonb_build_object('status','invalid_request');
    end if;
  else
    select count(*),count(*) filter(where lower(display_name)=lower(v_name)) into v_total,v_named
      from diary_private.entry_comments where owner_id=p_owner and created_at>now()-interval '1 minute';
    if v_total>=30 or v_named>=3 then return jsonb_build_object('status','rate_limited','retry_after',60); end if;
    insert into diary_private.entry_comments(owner_id,entry_id,display_name,body,request_id)
      values(p_owner,p_entry_id,v_name,v_body,p_request_id) returning * into v_row;
  end if;
  return jsonb_build_object('status','ok','comment',jsonb_build_object(
    'id',v_row.id::text,'name',v_row.display_name,'body',v_row.body,'created_at',v_row.created_at));
end;
$$;
revoke all on function diary_private.insert_comment(uuid,bigint,text,text,uuid) from public,anon,authenticated;

-- Guest endpoints intentionally use the existing code AND three-answer capability.
-- A typed name is a display label, never authorization or a verified identity.
create function public.get_private_diary_comments(p_alias text,p_code text,p_answers text[],p_entry_id bigint,p_before_id bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_access jsonb; v_owner uuid;
begin
  if p_entry_id is null or p_entry_id<=0 or (p_before_id is not null and p_before_id<=0) then return jsonb_build_object('status','invalid_request'); end if;
  v_access:=public.read_private_diary_verified(p_alias,p_code,p_answers,0);
  if v_access->>'status'<>'ok' then return v_access; end if;
  v_owner:=diary_private.guest_owner(p_alias,p_code);
  if not exists(select 1 from public.diary_entries where id=p_entry_id and user_id=v_owner) then return jsonb_build_object('status','not_found'); end if;
  return diary_private.comment_page(p_entry_id,p_before_id);
end;
$$;
revoke all on function public.get_private_diary_comments(text,text,text[],bigint,bigint) from public,anon,authenticated;
grant execute on function public.get_private_diary_comments(text,text,text[],bigint,bigint) to anon,authenticated;

create function public.add_private_diary_comment(p_alias text,p_code text,p_answers text[],p_entry_id bigint,p_name text,p_body text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_access jsonb; v_owner uuid;
begin
  v_access:=public.read_private_diary_verified(p_alias,p_code,p_answers,0);
  if v_access->>'status'<>'ok' then return v_access; end if;
  v_owner:=diary_private.guest_owner(p_alias,p_code);
  return diary_private.insert_comment(v_owner,p_entry_id,p_name,p_body,p_request_id);
end;
$$;
revoke all on function public.add_private_diary_comment(text,text,text[],bigint,text,text,uuid) from public,anon,authenticated;
grant execute on function public.add_private_diary_comment(text,text,text[],bigint,text,text,uuid) to anon,authenticated;

create function public.get_my_diary_comments(p_entry_id bigint,p_before_id bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.diary_entries where id=p_entry_id and user_id=auth.uid()) then return jsonb_build_object('status','not_found'); end if;
  if p_before_id is not null and p_before_id<=0 then return jsonb_build_object('status','invalid_request'); end if;
  return diary_private.comment_page(p_entry_id,p_before_id);
end;
$$;
revoke all on function public.get_my_diary_comments(bigint,bigint) from public,anon,authenticated;
grant execute on function public.get_my_diary_comments(bigint,bigint) to authenticated;

create function public.add_my_diary_comment(p_entry_id bigint,p_name text,p_body text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then return jsonb_build_object('status','not_found'); end if;
  return diary_private.insert_comment(auth.uid(),p_entry_id,p_name,p_body,p_request_id);
end;
$$;
revoke all on function public.add_my_diary_comment(bigint,text,text,uuid) from public,anon,authenticated;
grant execute on function public.add_my_diary_comment(bigint,text,text,uuid) to authenticated;

create function public.delete_my_diary_comment(p_entry_id bigint,p_comment_id bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_deleted bigint;
begin
  if auth.uid() is null then return jsonb_build_object('status','not_found'); end if;
  delete from diary_private.entry_comments c where c.id=p_comment_id and c.entry_id=p_entry_id
    and c.owner_id=auth.uid() and exists(select 1 from public.diary_entries d where d.id=c.entry_id and d.user_id=auth.uid())
    returning c.id into v_deleted;
  return jsonb_build_object('status',case when v_deleted is null then 'not_found' else 'ok' end);
end;
$$;
revoke all on function public.delete_my_diary_comment(bigint,bigint) from public,anon,authenticated;
grant execute on function public.delete_my_diary_comment(bigint,bigint) to authenticated;

-- Add stable string entry IDs for the per-entry comment controls.
CREATE OR REPLACE FUNCTION public.read_private_diary_verified(p_alias text, p_code text, p_answers text[], p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    order by d.entry_date desc,d.created_at desc,d.id desc offset p_offset limit 41
  ), items as (
    select * from page order by entry_date desc,created_at desc,id desc limit 40
  )
  select coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',i.id::text,'entry_date',i.entry_date,'title',i.title,'content',i.content)
    order by i.entry_date desc,i.created_at desc,i.id desc) from items i),'[]'::jsonb),
    (select pg_catalog.count(*)>40 from page) into v_items,v_more;
  return pg_catalog.jsonb_build_object('status','ok','entries',v_items,'has_more',v_more,'next_offset',p_offset+40);
end;
$function$
;

