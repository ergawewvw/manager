-- Daily Diary: multi-account access, owner-specific verification and private notes.
-- Non-destructive migration: retains existing notes, admin role and legacy question hashes.
-- IMPORTANT: deploy this SQL before publishing multi-user frontend code.
begin;

-- A user's notes are private regardless of platform-admin membership.
alter table public.diary_entries enable row level security;
drop policy if exists private_owner_read on public.diary_entries;
drop policy if exists private_owner_insert on public.diary_entries;
drop policy if exists private_owner_update on public.diary_entries;
drop policy if exists private_owner_delete on public.diary_entries;
create policy diary_owner_select on public.diary_entries for select to authenticated
  using (user_id = (select auth.uid()));
create policy diary_owner_insert on public.diary_entries for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy diary_owner_update on public.diary_entries for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy diary_owner_delete on public.diary_entries for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.diary_entries from anon;
grant select,insert,update,delete on public.diary_entries to authenticated;
grant usage,select on sequence public.diary_entries_id_seq to authenticated;

-- Every user chooses their own questions; never expose hashes in the Data API.
create table if not exists diary_private.owner_questions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  question_number integer not null check (question_number between 1 and 3),
  question_text text not null check (length(question_text) between 5 and 160),
  answer_hash text not null,
  primary key (owner_id,question_number)
);
alter table diary_private.owner_questions enable row level security;
revoke all on diary_private.owner_questions from public,anon,authenticated;

-- Retain the original owner's existing three questions without changing the answers.
insert into diary_private.owner_questions(owner_id,question_number,question_text,answer_hash)
select a.user_id,q.question_number,q.question_text,q.answer_hash
from diary_private.admins a cross join public.diary_questions q
where q.question_number between 1 and 3
on conflict(owner_id,question_number) do nothing;

-- Private security-definer helpers validate all access by auth.uid() / exact valid code.
create or replace function diary_private.guest_owner(p_alias text,p_code text)
returns uuid language sql stable security invoker set search_path = '' as $$
 select s.owner_id from diary_private.share_settings s
 where p_alias ~* '^[a-z0-9_-]{4,32}$' and p_code ~* '^[0-9a-f]{32}$'
   and s.alias=pg_catalog.lower(p_alias)
   and s.code_hash=pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(p_code),'UTF8'))
   and s.revoked_at is null and s.expires_at>pg_catalog.now()
 limit 1;
$$;
revoke all on function diary_private.guest_owner(text,text) from public,anon,authenticated;

-- Setup / replacement invalidates previously issued sharing codes.
create or replace function public.set_my_diary_questions(p_questions text[],p_answers text[])
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := (select auth.uid()); n integer; v_q text; v_a text;
begin
 if v_owner is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if pg_catalog.cardinality(p_questions)<>3 or pg_catalog.cardinality(p_answers)<>3
   or pg_catalog.array_ndims(p_questions)<>1 or pg_catalog.array_ndims(p_answers)<>1
   or pg_catalog.array_lower(p_questions,1)<>1 or pg_catalog.array_lower(p_answers,1)<>1
 then raise exception 'Exactly three questions and answers required'; end if;
 for n in 1..3 loop
   v_q := pg_catalog.btrim(p_questions[n]);
   v_a := pg_catalog.lower(pg_catalog.btrim(p_answers[n]));
   if v_q is null or length(v_q) not between 5 and 160 or v_a is null
      or length(v_a) not between 2 and 200 then
     raise exception 'Question length must be 5-160, answer length 2-200';
   end if;
 end loop;
 -- Atomic replacement: a failed request cannot delete existing questions.
 delete from diary_private.owner_questions where owner_id=v_owner;
 for n in 1..3 loop
  insert into diary_private.owner_questions(owner_id,question_number,question_text,answer_hash)
  values (v_owner,n,pg_catalog.btrim(p_questions[n]),
    extensions.crypt(pg_catalog.lower(pg_catalog.btrim(p_answers[n])),extensions.gen_salt('bf',10)));
 end loop;
 update diary_private.share_settings set revoked_at=pg_catalog.now()
 where owner_id=v_owner and revoked_at is null;
 delete from diary_private.share_access where owner_id=v_owner;
 delete from diary_private.guest_answer_attempts where owner_id=v_owner;
 return true;
end; $$;
revoke all on function public.set_my_diary_questions(text[],text[]) from public,anon,authenticated;
grant execute on function public.set_my_diary_questions(text[],text[]) to authenticated;

create or replace function public.my_diary_questions()
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'number',q.question_number,'text',q.question_text) order by q.question_number),'[]'::jsonb)
 from diary_private.owner_questions q where q.owner_id=(select auth.uid());
$$;
revoke all on function public.my_diary_questions() from public,anon,authenticated;
grant execute on function public.my_diary_questions() to authenticated;

create or replace function public.create_private_diary_code(p_alias text,p_days integer default 7)
returns table(share_alias text,share_code text,expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := (select auth.uid());
 v_alias text:=pg_catalog.lower(pg_catalog.btrim(p_alias));
 v_code text:=pg_catalog.encode(extensions.gen_random_bytes(16),'hex');
 v_exp timestamptz;
begin
 if v_owner is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if (select pg_catalog.count(*) from diary_private.owner_questions where owner_id=v_owner)<>3
 then raise exception 'Set your three security questions first'; end if;
 if v_alias is null or v_alias !~ '^[a-z0-9_-]{4,32}$'
 then raise exception 'Name must contain 4-32 letters, digits, _ or -'; end if;
 if p_days is null or p_days not in (1,7,30)
 then raise exception 'Invalid expiration period'; end if;
 v_exp:=pg_catalog.now()+pg_catalog.make_interval(days=>p_days);
 insert into diary_private.share_settings(owner_id,alias,code_hash,expires_at,revoked_at)
 values(v_owner,v_alias,pg_catalog.sha256(pg_catalog.convert_to(v_code,'UTF8')),v_exp,null)
 on conflict(owner_id) do update set
 alias=excluded.alias,code_hash=excluded.code_hash,expires_at=excluded.expires_at,
 revoked_at=null,created_at=pg_catalog.now();
 delete from diary_private.share_access where owner_id=v_owner;
 delete from diary_private.guest_answer_attempts where owner_id=v_owner;
 return query select v_alias,v_code,v_exp;
end; $$;
revoke all on function public.create_private_diary_code(text,integer) from public,anon,authenticated;
grant execute on function public.create_private_diary_code(text,integer) to authenticated;

create or replace function public.revoke_private_diary_code()
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_owner uuid:=(select auth.uid()); v_count integer;
begin
 if v_owner is null then raise exception 'Sign in required' using errcode='42501'; end if;
 update diary_private.share_settings set revoked_at=pg_catalog.now()
 where owner_id=v_owner and revoked_at is null;
 get diagnostics v_count = row_count;
 delete from diary_private.share_access where owner_id=v_owner;
 delete from diary_private.guest_answer_attempts where owner_id=v_owner;
 return v_count > 0;
end; $$;
revoke all on function public.revoke_private_diary_code() from public,anon,authenticated;
grant execute on function public.revoke_private_diary_code() to authenticated;

create or replace function public.get_private_diary_questions(p_alias text,p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_questions jsonb; v_blocked timestamptz;
begin
 v_owner:=diary_private.guest_owner(p_alias,p_code);
 if v_owner is null then return pg_catalog.jsonb_build_object('status','invalid_code'); end if;
 select a.blocked_until into v_blocked from diary_private.guest_answer_attempts a
 where a.owner_id=v_owner and a.code_hash=pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(p_code),'UTF8'));
 if v_blocked>pg_catalog.now() then
  return pg_catalog.jsonb_build_object('status','blocked','blocked_until',v_blocked);
 end if;
 select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('number',q.question_number,'text',q.question_text) order by q.question_number)
 into v_questions from diary_private.owner_questions q where q.owner_id=v_owner;
 if pg_catalog.jsonb_array_length(coalesce(v_questions,'[]'::jsonb))<>3
 then return pg_catalog.jsonb_build_object('status','not_configured'); end if;
 return pg_catalog.jsonb_build_object('status','questions_required','questions',v_questions);
end; $$;
revoke all on function public.get_private_diary_questions(text,text) from public,anon,authenticated;
grant execute on function public.get_private_diary_questions(text,text) to anon,authenticated;

create or replace function public.read_private_diary_verified(p_alias text,p_code text,p_answers text[],p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_hash bytea; v_attempt diary_private.guest_answer_attempts%rowtype;
 v_question record; v_ok boolean:=true; v_count integer:=0;
 v_answer text; v_items jsonb; v_more boolean;
begin
 if p_offset is null or p_offset<0 or p_offset>1000000
 then return pg_catalog.jsonb_build_object('status','invalid_request'); end if;
 v_owner:=diary_private.guest_owner(p_alias,p_code);
 if v_owner is null then return pg_catalog.jsonb_build_object('status','invalid_code'); end if;
 v_hash:=pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(p_code),'UTF8'));
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
 if p_answers is null or pg_catalog.array_ndims(p_answers)<>1 or pg_catalog.cardinality(p_answers)<>3
    or pg_catalog.array_lower(p_answers,1)<>1 then v_ok:=false; end if;
 for v_question in select question_number,answer_hash from diary_private.owner_questions
 where owner_id=v_owner and question_number between 1 and 3 order by question_number
 loop
  v_count:=v_count+1;
  v_answer:=p_answers[v_question.question_number];
  if v_answer is null or pg_catalog.length(v_answer)<1 or pg_catalog.length(v_answer)>200 then
    v_ok:=false;
  elsif v_question.answer_hash like '$2%' then
    if extensions.crypt(pg_catalog.lower(pg_catalog.btrim(v_answer)),v_question.answer_hash)
       is distinct from v_question.answer_hash then v_ok:=false; end if;
  elsif v_question.answer_hash ~ '^[0-9a-f]{64}$' then
    if v_question.answer_hash not in (
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(v_answer)),'UTF8')),'hex'),
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(v_answer),'UTF8')),'hex'),
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(diary_private.normalize_guest_answer(v_question.question_number,v_answer),''),'UTF8')),'hex')
    ) then v_ok:=false; end if;
  else v_ok:=false;
  end if;
 end loop;
 if v_count<>3 then return pg_catalog.jsonb_build_object('status','not_configured'); end if;
 if not v_ok then
   update diary_private.guest_answer_attempts set failed_attempts=least(failed_attempts+1,5),
   blocked_until=case when failed_attempts+1>=5 then pg_catalog.now()+interval '24 hours' else null end
   where owner_id=v_owner returning * into v_attempt;
   return pg_catalog.jsonb_build_object('status',
    case when v_attempt.blocked_until is not null then 'blocked' else 'invalid_answers' end,
    'attempts_remaining',5-v_attempt.failed_attempts,'blocked_until',v_attempt.blocked_until);
 end if;
 update diary_private.guest_answer_attempts set failed_attempts=0,window_started_at=pg_catalog.now(),blocked_until=null where owner_id=v_owner;
 with page as (
  select d.entry_date,d.title,d.content,d.created_at,d.id from public.diary_entries d
  where d.user_id=v_owner order by d.entry_date desc,d.created_at desc,d.id desc
  offset p_offset limit 501
 ), items as (select * from page order by entry_date desc,created_at desc,id desc limit 500)
 select coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'entry_date',i.entry_date,'title',i.title,'content',i.content)
   order by i.entry_date desc,i.created_at desc,i.id desc) from items i),'[]'::jsonb),
   (select pg_catalog.count(*)>500 from page) into v_items,v_more;
 return pg_catalog.jsonb_build_object('status','ok','entries',v_items,'has_more',v_more,'next_offset',p_offset+500);
end; $$;
revoke all on function public.read_private_diary_verified(text,text,text[],integer) from public,anon,authenticated;
grant execute on function public.read_private_diary_verified(text,text,text[],integer) to anon,authenticated;

-- Obsolete code-only access must never bypass three question checks.
revoke execute on function public.read_private_diary_with_code(text,text) from public,anon,authenticated;
revoke execute on function public.redeem_diary_share(text,text) from public,anon,authenticated;
revoke execute on function public.create_diary_share(text,integer) from public,anon,authenticated;
revoke execute on function public.can_view_shared_diary(uuid) from public,anon,authenticated;
revoke execute on function public.my_diary_share() from public,anon;
grant execute on function public.my_diary_share() to authenticated;
revoke all on public.diary_questions from public,anon,authenticated;
commit;
