-- Synthetic accounts and entries only; the complete test rolls back.
begin;
set local statement_timeout='25s';
create temp table comment_qa as select gen_random_uuid() owner_id,gen_random_uuid() other_id,
 'qa_comments_'||substr(replace(gen_random_uuid()::text,'-',''),1,16) alias,gen_random_uuid() request_id;
grant select on comment_qa to anon,authenticated;
insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at)
 select owner_id,'comment-qa-'||owner_id||'@example.invalid','authenticated','authenticated',now(),now(),now() from comment_qa
 union all select other_id,'comment-qa-'||other_id||'@example.invalid','authenticated','authenticated',now(),now(),now() from comment_qa;
insert into diary_private.admins(user_id) select owner_id from comment_qa;
update public.diary_questions set answer_hash=encode(sha256(convert_to('comment-fixture-'||question_number,'UTF8')),'hex') where question_number between 1 and 3;
insert into diary_private.share_settings(owner_id,alias,code_hash,expires_at,revoked_at)
 select owner_id,alias,sha256(convert_to(repeat('a',32),'UTF8')),now()+interval '1 hour',null from comment_qa;
create temp table comment_qa_entries as
 with inserted as (insert into public.diary_entries(user_id,title,content,entry_date)
  select owner_id,'Comments QA','Fixture note',current_date from comment_qa
  union all select other_id,'Other QA','Other fixture note',current_date from comment_qa returning id,user_id)
 select id,user_id from inserted;
grant select on comment_qa_entries to anon,authenticated;
set local role anon;
do $$
declare a text;e bigint;other_e bigint;req uuid;r jsonb;first_id text;denied boolean:=false;
begin
 select alias,request_id into a,req from comment_qa;
 select id into e from comment_qa_entries where user_id=(select owner_id from comment_qa);
 select id into other_e from comment_qa_entries where user_id=(select other_id from comment_qa);
 begin execute 'select count(*) from diary_private.entry_comments'; exception when insufficient_privilege then denied:=true;end;
 assert denied,'Anonymous direct table read was allowed';
 assert not has_function_privilege(current_user,'public.delete_my_diary_comment(bigint,bigint)','EXECUTE'),'Guest may delete comments';
 r:=public.get_private_diary_comments(a,repeat('b',32),array['comment-fixture-1','comment-fixture-2','comment-fixture-3'],e);
 assert r->>'status'='invalid_code' and not(r?'comments'),'Bad code exposed comments';
 r:=public.add_private_diary_comment(a,repeat('a',32),null,e,'Ali','No access',req);
 assert r->>'status'='invalid_answers','Missing answers wrote a comment';
 r:=public.read_private_diary_verified(a,repeat('a',32),array['comment-fixture-1','comment-fixture-2','comment-fixture-3']);
 assert r->>'status'='ok' and (r->'entries'->0->>'id')=e::text,'Guest entries missing stable IDs';
 r:=public.add_private_diary_comment(a,repeat('a',32),array['comment-fixture-1','comment-fixture-2','comment-fixture-3'],other_e,'Ali','Wrong diary',req);
 assert r->>'status'='not_found','Cross-diary comment accepted';
 r:=public.get_private_diary_comments(a,repeat('a',32),array['comment-fixture-1','comment-fixture-2','comment-fixture-3'],other_e);
 assert r->>'status'='not_found' and not(r?'comments'),'Cross-diary read accepted';
 r:=public.add_private_diary_comment(a,repeat('a',32),array['comment-fixture-1','comment-fixture-2','comment-fixture-3'],e,'123','Name required',req);
 assert r->>'status'='invalid_input','Non-name accepted';
 r:=public.add_private_diary_comment(a,repeat('a',32),array['comment-fixture-1','comment-fixture-2','comment-fixture-3'],e,'Ali',repeat('x',2001),req);
 assert r->>'status'='invalid_input','Oversized comment accepted';
 r:=public.add_private_diary_comment(a,repeat('a',32),array['comment-fixture-1','comment-fixture-2','comment-fixture-3'],e,' Ali ','<img src=x onerror=alert(1)>',req);
 assert r->>'status'='ok' and r->'comment'->>'name'='Ali' and r->'comment'->>'body'='<img src=x onerror=alert(1)>','Valid text comment failed';
 first_id:=r->'comment'->>'id';
 r:=public.add_private_diary_comment(a,repeat('a',32),array['comment-fixture-1','comment-fixture-2','comment-fixture-3'],e,'Ali','<img src=x onerror=alert(1)>',req);
 assert r->>'status'='ok' and r->'comment'->>'id'=first_id,'Retry created a duplicate';
 r:=public.add_private_diary_comment(a,repeat('a',32),array['comment-fixture-1','comment-fixture-2','comment-fixture-3'],e,'Ali','Different payload',req);
 assert r->>'status'='invalid_request','Request ID reused with another payload';
 perform public.add_private_diary_comment(a,repeat('a',32),array['comment-fixture-1','comment-fixture-2','comment-fixture-3'],e,'Ali','Second',gen_random_uuid());
 perform public.add_private_diary_comment(a,repeat('a',32),array['comment-fixture-1','comment-fixture-2','comment-fixture-3'],e,'Ali','Third',gen_random_uuid());
 r:=public.add_private_diary_comment(a,repeat('a',32),array['comment-fixture-1','comment-fixture-2','comment-fixture-3'],e,'Ali','Too fast',gen_random_uuid());
 assert r->>'status'='rate_limited','Rate limit failed';
 r:=public.get_private_diary_comments(a,repeat('a',32),array['comment-fixture-1','comment-fixture-2','comment-fixture-3'],e);
 assert r->>'status'='ok' and jsonb_array_length(r->'comments')=3,'Saved comments not readable';
end $$;
reset role;
insert into diary_private.entry_comments(owner_id,entry_id,display_name,body,request_id,created_at)
 select q.owner_id,e.id,'Fixture reader','Page fixture '||g,gen_random_uuid(),now()-interval '2 minutes'
 from comment_qa q join comment_qa_entries e on e.user_id=q.owner_id cross join generate_series(1,24) g;
set local role anon;
do $$ declare a text;e bigint;r jsonb;cursor_id bigint;begin
 select alias into a from comment_qa; select id into e from comment_qa_entries where user_id=(select owner_id from comment_qa);
 r:=public.get_private_diary_comments(a,repeat('a',32),array['comment-fixture-1','comment-fixture-2','comment-fixture-3'],e);
 assert jsonb_array_length(r->'comments')=20 and (r->>'has_more')::boolean,'First comment page not bounded';
 cursor_id:=(r->'comments'->19->>'id')::bigint;
 r:=public.get_private_diary_comments(a,repeat('a',32),array['comment-fixture-1','comment-fixture-2','comment-fixture-3'],e,cursor_id);
 assert jsonb_array_length(r->'comments')=7 and not (r->>'has_more')::boolean,'Comment cursor pagination failed';
 assert (r->'comments'->0->>'id')::bigint<cursor_id,'Cursor repeated comments';
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select other_id::text from comment_qa),true);
do $$ declare e bigint;r jsonb;begin
 select id into e from comment_qa_entries where user_id=(select owner_id from comment_qa);
 r:=public.get_my_diary_comments(e); assert r->>'status'='not_found','Another owner read comments';
 r:=public.add_my_diary_comment(e,'Other owner','Cross-owner write',gen_random_uuid());assert r->>'status'='not_found','Another owner wrote comments';
 r:=public.delete_my_diary_comment(e,1);assert r->>'status'='not_found','Another owner deleted comments';
end $$;
select set_config('request.jwt.claim.sub',(select owner_id::text from comment_qa),true);
do $$ declare e bigint;r jsonb;comment_id bigint;begin
 select id into e from comment_qa_entries where user_id=(select owner_id from comment_qa);
 r:=public.get_my_diary_comments(e);assert r->>'status'='ok' and jsonb_array_length(r->'comments')=20,'Owner cannot read comments';
 comment_id:=(r->'comments'->0->>'id')::bigint;
 r:=public.delete_my_diary_comment(e,comment_id);assert r->>'status'='ok','Owner cannot moderate';
 r:=public.add_my_diary_comment(e,'Owner','Owner reply',gen_random_uuid());assert r->>'status'='ok','Owner cannot comment';
end $$;
reset role;
update diary_private.share_settings set revoked_at=now() where owner_id=(select owner_id from comment_qa);
set local role anon;
do $$ declare a text;e bigint;r jsonb;begin
 select alias into a from comment_qa;select id into e from comment_qa_entries where user_id=(select owner_id from comment_qa);
 r:=public.get_private_diary_comments(a,repeat('a',32),array['comment-fixture-1','comment-fixture-2','comment-fixture-3'],e);
 assert r->>'status'='invalid_code' and not(r?'comments'),'Revoked code read comments';
 r:=public.add_private_diary_comment(a,repeat('a',32),array['comment-fixture-1','comment-fixture-2','comment-fixture-3'],e,'Reader','Revoked write',gen_random_uuid());
 assert r->>'status'='invalid_code','Revoked code wrote comments';
end $$;
reset role;
delete from public.diary_entries where id in(select id from comment_qa_entries);
do $$ begin assert not exists(select 1 from diary_private.entry_comments where owner_id=(select owner_id from comment_qa)),'Entry deletion did not remove its comments';end $$;
select 'PASS' as result,'Comments: code+answers, ownership, validation, retry deduplication, throttling, 20/7 pages, moderation, revocation and cascade; rolled back' as checks;
rollback;
