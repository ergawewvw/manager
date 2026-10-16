-- Rollback-only tests with synthetic answers; never commit these fixture changes.
begin;
update public.diary_questions set answer_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  case question_number when 1 then '2004-06-23' when 2 then '2025-06-02' when 3 then 'fixturename' end,'UTF8')),'hex')
where question_number between 1 and 3;
insert into diary_private.share_settings(owner_id,alias,code_hash,expires_at,revoked_at)
select user_id,'normalization_fixture',pg_catalog.sha256(pg_catalog.convert_to(repeat('d',32),'UTF8')),now()+interval '1 hour',null
from diary_private.admins limit 1
on conflict(owner_id) do update set alias=excluded.alias,code_hash=excluded.code_hash,expires_at=excluded.expires_at,revoked_at=null;
delete from diary_private.guest_answer_attempts where owner_id in(select user_id from diary_private.admins);
set local role anon;
do $$
declare input_value text; r jsonb;
begin
  foreach input_value in array array['23-iyun 2004 yil','23 IYUN 2004-YIL','23.06.2004','23/6/2004','2004-06-23','23 June 2004','23062004','20040623','6/23/2004'] loop
    r := public.read_private_diary_verified('normalization_fixture',repeat('d',32),array[input_value,'2-iyun 2025 yil',' FixtureName ']);
    assert r->>'status'='ok','Equivalent date format rejected';
  end loop;
  r := public.read_private_diary_verified('normalization_fixture',repeat('d',32),array['2004-06-23','02/06/2025','ＦＩＸＴＵＲＥＮＡＭＥ']);
  assert r->>'status'='ok','Unicode/case normalization failed';
  r := public.read_private_diary_verified('normalization_fixture',repeat('d',32),array['23 06 2004','2025-06-02',' F i x t u r e N a m e! ']);
  assert r->>'status'='ok','Whitespace normalization failed';
  r := public.read_private_diary_verified('normalization_fixture',repeat('d',32),array['24.06.2004','02.06.2025','FixtureName']);
  assert r->>'status'='invalid_answers' and not(r ? 'entries'),'Wrong date accepted';
  r := public.read_private_diary_verified('normalization_fixture',repeat('d',32),array['31.06.2004','02.06.2025','FixtureName']);
  assert r->>'status'='invalid_answers' and not(r ? 'entries'),'Impossible date accepted';
  r := public.read_private_diary_verified('normalization_fixture',repeat('d',32),array['random text','02.06.2025','FixtureName']);
  assert r->>'status'='invalid_answers' and not(r ? 'entries'),'Unparseable date bypassed verification';
  r := public.read_private_diary_verified('normalization_fixture',repeat('d',32),array['23.06.2004','02.06.2025','WrongName']);
  assert r->>'status'='invalid_answers' and not(r ? 'entries'),'Wrong name accepted';
end $$;
reset role;
select 'normalization_assertions_passed' as result;
rollback;
