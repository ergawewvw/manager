-- Isolated fixtures only. Successful completion ends in ROLLBACK.
begin;
set local statement_timeout='45s';
create temp table diary_qa_users as select gen_random_uuid() as a,gen_random_uuid() as b;
grant select on diary_qa_users to authenticated;
insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at)
select a,'diary-qa-a-'||a::text||'@example.invalid','authenticated','authenticated',now(),now(),now() from diary_qa_users
union all select b,'diary-qa-b-'||b::text||'@example.invalid','authenticated','authenticated',now(),now(),now() from diary_qa_users;
insert into public.diary_entries(user_id,title,content,entry_date)
select u.a,'QA note '||g,case when g=1 then 'literal%_marker ' else '' end||repeat('sample body ',60),date '2025-01-01'+(g%365)
from diary_qa_users u cross join generate_series(1,10000) g;
insert into public.diary_entries(user_id,title,content,entry_date)
select b,'FOREIGN private note','Only the second owner may read this',date '2025-01-01' from diary_qa_users;
select set_config('request.jwt.claim.sub',(select a::text from diary_qa_users),true);
select set_config('request.jwt.claims',json_build_object('sub',(select a from diary_qa_users),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare
 p jsonb; q jsonb; imported jsonb; last_item jsonb; result jsonb;
 t timestamptz; first_ms numeric; search_ms numeric; export_count integer:=0;
 after_id bigint:=0; max_id bigint; affected integer; rejected boolean;
begin
 t:=clock_timestamp(); p:=public.get_my_diary_page('','',null,null,date '2025-01-01');
 first_ms:=extract(epoch from clock_timestamp()-t)*1000;
 assert (p->'stats'->>'total')::int=10000,'Owner total mismatch';
 assert jsonb_array_length(p->'entries')=40 and (p->>'has_more')::boolean,'Page is not bounded';
 assert not ((p->'entries'->0) ? 'content'),'List leaked full note bodies';
 assert length(p->'entries'->0->>'preview')=320,'Preview is not bounded';
 last_item:=p->'entries'->39;
 q:=public.get_my_diary_page('','',(last_item->>'entry_date')::date,(last_item->>'id')::bigint,date '2025-01-01');
 assert jsonb_array_length(q->'entries')=40,'Second page missing';
 assert not exists(select 1 from jsonb_array_elements(p->'entries') a cross join jsonb_array_elements(q->'entries') b where a->>'id'=b->>'id'),'Cursor returned overlapping pages';
 t:=clock_timestamp();q:=public.get_my_diary_page('%_marker');search_ms:=extract(epoch from clock_timestamp()-t)*1000;
 assert jsonb_array_length(q->'entries')=1,'Search wildcards were not treated literally';
 q:=public.get_my_diary_page('FOREIGN');assert jsonb_array_length(q->'entries')=0,'Other owner search leaked';
 q:=public.get_my_diary_page('','2025-01');
 assert not exists(select 1 from jsonb_array_elements(q->'entries') e where left(e->>'entry_date',7)<>'2025-01'),'Month filter mismatch';
 rejected:=false;begin perform public.get_my_diary_page(repeat('x',201));exception when invalid_parameter_value then rejected:=true;end;
 assert rejected,'Unbounded search accepted';
 rejected:=false;begin perform public.get_my_diary_page('','2025-99');exception when invalid_parameter_value then rejected:=true;end;
 assert rejected,'Invalid month accepted';
 assert (select count(*) from public.diary_entries)=10000,'Direct-table RLS failed';
 update public.diary_entries set title='Unauthorized' where user_id=(select b from diary_qa_users);
 get diagnostics affected=row_count;assert affected=0,'Other-owner update succeeded';
 rejected:=false;begin insert into public.diary_entries(user_id,title,content,entry_date) select b,'Unauthorized','body',current_date from diary_qa_users;exception when insufficient_privilege then rejected:=true;end;
 assert rejected,'Other-owner insert succeeded';
 rejected:=false;begin insert into public.diary_entries(user_id,title,content,entry_date) values(auth.uid(),repeat('x',121),'body',current_date);exception when check_violation then rejected:=true;end;
 assert rejected,'Server length validation failed';
 rejected:=false;begin perform * from diary_private.admins;exception when insufficient_privilege then rejected:=true;end;
 assert rejected,'Private schema became readable';
 imported:=jsonb_build_array(jsonb_build_object('title','QA restored','content','full restored body','entry_date','2026-01-01','user_id',(select b from diary_qa_users)));
 result:=public.import_my_diary_entries(imported);assert (result->>'inserted')::int=1,'Import failed';
 assert (select user_id=auth.uid() from public.diary_entries where title='QA restored'),'Import accepted a foreign owner';
 result:=public.import_my_diary_entries(imported);assert (result->>'inserted')::int=0 and (result->>'skipped')::int=1,'Import retry duplicated notes';
 rejected:=false;begin perform public.import_my_diary_entries(imported||jsonb_build_array(jsonb_build_object('title','Bad','content','body','entry_date','2026-02-30')));exception when datetime_field_overflow then rejected:=true;end;
 assert rejected,'Invalid backup date accepted';
 assert (select count(*) from public.diary_entries)=10001,'Invalid import partially committed';
 loop
  result:=public.export_my_diary_page(after_id,max_id);
  max_id:=(result->>'max_id')::bigint;
  assert jsonb_array_length(result->'entries')<=100,'Export batch is not bounded';
  assert not exists(select 1 from jsonb_array_elements(result->'entries') e where e ? 'user_id' or e->>'title'='FOREIGN private note'),'Export leaked owner data';
  export_count:=export_count+jsonb_array_length(result->'entries');
  exit when not (result->>'has_more')::boolean;
  assert (result->>'next_id')::bigint>after_id,'Export cursor did not progress';
  after_id:=(result->>'next_id')::bigint;
 end loop;
 assert export_count=10001,'Export omitted notes';
 assert not has_function_privilege('anon','public.get_my_diary_page(text,text,date,bigint,date)','EXECUTE'),'Anonymous read RPC executable';
 assert not has_function_privilege('anon','public.import_my_diary_entries(jsonb)','EXECUTE'),'Anonymous import executable';
 raise notice 'PASS: 10000-note owner isolation, bounded pages, literal search, full export, safe import; first page % ms, literal search % ms',round(first_ms,2),round(search_ms,2);
end $$;
reset role;
select 'PASS' as result,'10000 fixture notes; pagination, RLS, search, export, import assertions passed; fixtures rolled back' as checks;
rollback;
