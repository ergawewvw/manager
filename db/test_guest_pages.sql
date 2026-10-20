-- Only synthetic owner/sharing fixtures are changed; everything rolls back.
begin;
set local statement_timeout='20s';
create temp table guest_qa_owner as select gen_random_uuid() as id,'qa_guest_'||substr(replace(gen_random_uuid()::text,'-',''),1,16) as alias;
grant select on guest_qa_owner to anon;
insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at)
 select id,'guest-qa-'||id::text||'@example.invalid','authenticated','authenticated',now(),now(),now() from guest_qa_owner;
insert into diary_private.admins(user_id) select id from guest_qa_owner;
update public.diary_questions set answer_hash=encode(sha256(convert_to('fixture-answer-'||question_number,'UTF8')),'hex') where question_number between 1 and 3;
insert into diary_private.share_settings(owner_id,alias,code_hash,expires_at,revoked_at)
 select id,alias,sha256(convert_to(repeat('a',32),'UTF8')),now()+interval '1 hour',null from guest_qa_owner;
insert into public.diary_entries(user_id,title,content,entry_date)
 select id,'Guest QA '||g,'Private fixture body',current_date from guest_qa_owner cross join generate_series(1,81) g;
set local role anon;
do $$
declare a text; r jsonb; i int;
begin
 select alias into a from guest_qa_owner;
 assert not has_function_privilege(current_user,'public.read_private_diary_with_code(text,text)','EXECUTE'),'Legacy bypass enabled';
 r:=public.get_private_diary_questions(a,repeat('b',32));assert r->>'status'='invalid_code','Bad code accepted';
 r:=public.get_private_diary_questions(a,repeat('a',32));assert r->>'status'='questions_required' and jsonb_array_length(r->'questions')=3 and not (r ? 'entries'),'Stage-one leaked notes';
 r:=public.read_private_diary_verified(a,repeat('a',32),null);assert r->>'status'='invalid_answers' and not (r ? 'entries'),'Missing answers bypassed verification';
 r:=public.read_private_diary_verified(a,repeat('a',32),array['fixture-answer-1','fixture-answer-2','fixture-answer-3']);
 assert r->>'status'='ok' and jsonb_array_length(r->'entries')=40 and (r->>'has_more')::boolean and (r->>'next_offset')::int=40,'First page not bounded';
 r:=public.read_private_diary_verified(a,repeat('a',32),array['fixture-answer-1','fixture-answer-2','fixture-answer-3'],40);
 assert jsonb_array_length(r->'entries')=40 and (r->>'has_more')::boolean,'Second guest page failed';
 r:=public.read_private_diary_verified(a,repeat('a',32),array['fixture-answer-1','fixture-answer-2','fixture-answer-3'],80);
 assert jsonb_array_length(r->'entries')=1 and not (r->>'has_more')::boolean,'Last guest page failed';
 for i in 1..5 loop r:=public.read_private_diary_verified(a,repeat('a',32),array['bad','bad','bad']);end loop;
 assert r->>'status'='blocked' and (r->>'blocked_until')::timestamptz>=now()+interval '24 hours','Lockout failed';
 r:=public.read_private_diary_verified(a,repeat('a',32),array['fixture-answer-1','fixture-answer-2','fixture-answer-3']);assert r->>'status'='blocked' and not(r ? 'entries'),'Lockout bypassed';
end $$;
reset role;
update diary_private.share_settings set code_hash=sha256(convert_to(repeat('c',32),'UTF8')) where owner_id=(select id from guest_qa_owner);
set local role anon;
do $$ declare a text;r jsonb;begin
 select alias into a from guest_qa_owner;
 assert public.read_private_diary_verified(a,repeat('a',32),array['fixture-answer-1','fixture-answer-2','fixture-answer-3'])->>'status'='invalid_code','Rotated code accepted';
 r:=public.read_private_diary_verified(a,repeat('c',32),array['fixture-answer-1','fixture-answer-2','fixture-answer-3']);assert r->>'status'='ok','New code remained locked';
end $$;
reset role;
update diary_private.share_settings set revoked_at=now() where owner_id=(select id from guest_qa_owner);
set local role anon;
do $$ begin assert public.read_private_diary_verified((select alias from guest_qa_owner),repeat('c',32),array['fixture-answer-1','fixture-answer-2','fixture-answer-3'])->>'status'='invalid_code','Revocation failed';end $$;
reset role;
select 'PASS' as result,'81 synthetic guest entries: 40/40/1 pages; 3-answer check, 24-hour lockout, rotation and revocation passed; rollback' as checks;
rollback;
