-- Self-contained rollback-only test: never commits fixture data.
begin;
-- Run AFTER guest_verification.sql, inside the same transaction if testing before deployment.
-- All fixtures must be rolled back; no real answers/codes are read or printed.
update public.diary_questions set answer_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('fixture-answer-'||question_number,'UTF8')),'hex')
  where question_number between 1 and 3;
insert into diary_private.share_settings(owner_id,alias,code_hash,expires_at,revoked_at)
  select user_id,'guest_verification_fixture',pg_catalog.sha256(pg_catalog.convert_to(repeat('a',32),'UTF8')),now()+interval '1 hour',null
  from diary_private.admins limit 1
  on conflict(owner_id) do update set alias=excluded.alias,code_hash=excluded.code_hash,expires_at=excluded.expires_at,revoked_at=null;
delete from diary_private.guest_answer_attempts where owner_id in(select user_id from diary_private.admins);
insert into public.diary_entries(user_id,title,content,entry_date)
  select user_id,'__guest_verification_fixture__','__private_fixture__',current_date from diary_private.admins limit 1;
set local role anon;
do $$
declare r jsonb; i integer;
begin
  assert not has_function_privilege(current_user,'public.read_private_diary_with_code(text,text)','execute'), 'Legacy bypass still allowed';
  r := public.get_private_diary_questions('guest_verification_fixture',repeat('b',32));
  assert r->>'status'='invalid_code', 'Bad code accepted';
  r := public.get_private_diary_questions('guest_verification_fixture',repeat('a',32));
  assert r->>'status'='questions_required' and jsonb_array_length(r->'questions')=3 and not(r ? 'entries'), 'Stage one returned notes or wrong questions';
  assert not ((r->'questions'->0) ? 'answer_hash'), 'Answer hash leaked';
  r := public.read_private_diary_verified('guest_verification_fixture',repeat('a',32),null);
  assert r->>'status'='invalid_answers' and not(r ? 'entries'), 'Missing answers bypassed stage two';
  r := public.read_private_diary_verified('guest_verification_fixture',repeat('a',32),array['bad','bad','bad']);
  assert r->>'status'='invalid_answers' and not(r ? 'entries'), 'Wrong answers revealed notes';
  r := public.read_private_diary_verified('guest_verification_fixture',repeat('a',32),array['fixture-answer-1','fixture-answer-2','fixture-answer-3']);
  assert r->>'status'='ok' and jsonb_array_length(r->'entries')>0, 'Correct answers failed';
  assert exists(select 1 from jsonb_array_elements(r->'entries') e where e->>'title'='__guest_verification_fixture__'), 'Verified note missing';
  for i in 1..5 loop
    r := public.read_private_diary_verified('guest_verification_fixture',repeat('a',32),array['bad','bad','bad']);
  end loop;
  assert r->>'status'='blocked', 'Five failures did not block';
  assert (r->>'blocked_until')::timestamptz>=now()+interval '24 hours', 'Lockout is shorter than one day';
  r := public.read_private_diary_verified('guest_verification_fixture',repeat('a',32),array['fixture-answer-1','fixture-answer-2','fixture-answer-3']);
  assert r->>'status'='blocked' and not(r ? 'entries'), 'Lockout bypassed';
end $$;
reset role;
-- A recent block must outlive the original attempt window.
update diary_private.guest_answer_attempts set window_started_at=now()-interval '16 minutes',blocked_until=now()+interval '10 minutes';
set local role anon;
do $$ begin
  assert public.read_private_diary_verified('guest_verification_fixture',repeat('a',32),array['fixture-answer-1','fixture-answer-2','fixture-answer-3'])->>'status'='blocked','Old attempt window bypassed active lockout';
end $$;
reset role;
-- Rotating a code invalidates the old code and starts a fresh attempt budget.
update diary_private.share_settings set code_hash=pg_catalog.sha256(pg_catalog.convert_to(repeat('c',32),'UTF8')) where alias='guest_verification_fixture';
set local role anon;
do $$ begin
  assert public.read_private_diary_verified('guest_verification_fixture',repeat('a',32),array['fixture-answer-1','fixture-answer-2','fixture-answer-3'])->>'status'='invalid_code','Old code survived rotation';
  assert public.read_private_diary_verified('guest_verification_fixture',repeat('c',32),array['fixture-answer-1','fixture-answer-2','fixture-answer-3'])->>'status'='ok','Rotated code remained locked';
end $$;
reset role;
update diary_private.share_settings set expires_at=now()-interval '1 minute' where alias='guest_verification_fixture';
set local role anon;
do $$ begin
  assert public.read_private_diary_verified('guest_verification_fixture',repeat('c',32),array['fixture-answer-1','fixture-answer-2','fixture-answer-3'])->>'status'='invalid_code','Expired code accepted';
end $$;
reset role;
update diary_private.share_settings set expires_at=now()+interval '1 hour',revoked_at=now() where alias='guest_verification_fixture';
set local role anon;
do $$ begin
  assert public.read_private_diary_verified('guest_verification_fixture',repeat('c',32),array['fixture-answer-1','fixture-answer-2','fixture-answer-3'])->>'status'='invalid_code','Revoked code accepted';
end $$;
reset role;
select 'guest_verification_assertions_passed' as result;

rollback;
