-- Bounded reads, owner-scoped imports, and defense in depth.
create extension if not exists pg_trgm with schema extensions;
create index if not exists diary_entries_owner_page_idx on public.diary_entries(user_id,entry_date desc,id desc);
create index if not exists diary_entries_owner_export_idx on public.diary_entries(user_id,id);
create index if not exists diary_entries_search_idx on public.diary_entries using gin ((title || ' ' || content) extensions.gin_trgm_ops);
alter table public.diary_entries add constraint diary_entries_lengths_check check (char_length(btrim(title)) between 1 and 120 and char_length(btrim(content)) between 1 and 20000);
alter table public.diary_entries alter column user_id set not null;
alter table diary_private.admins enable row level security;
alter table diary_private.share_settings enable row level security;
alter table diary_private.share_access enable row level security;

create or replace function public.get_my_diary_page(
 p_search text default '', p_month text default '',
 p_before_date date default null, p_before_id bigint default null,
 p_today date default current_date
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
 v_owner uuid := (select auth.uid()); v_query text := btrim(coalesce(p_search,''));
 v_start date; v_end date; v_pattern text; v_result jsonb;
begin
 if v_owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if char_length(v_query)>200 or (p_before_date is null)<>(p_before_id is null) or p_today is null then
  raise exception 'Invalid request' using errcode='22023'; end if;
 if coalesce(p_month,'')<>'' then
  if p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or left(p_month,4)='0000' then
   raise exception 'Invalid month' using errcode='22023'; end if;
  v_start := (p_month||'-01')::date; v_end := (v_start+interval '1 month')::date;
 end if;
 -- Literal substring search: wildcards and punctuation are data, never SQL/filter syntax.
 v_pattern := '%'||replace(replace(replace(v_query,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
 with page as materialized (
  select d.id,d.title,d.entry_date,d.created_at,d.updated_at,substring(d.content for 320) as preview,
         char_length(d.content)>320 as truncated
  from public.diary_entries d
  where d.user_id=v_owner
   and (v_start is null or (d.entry_date>=v_start and d.entry_date<v_end))
   and (v_query='' or (d.title||' '||d.content) ilike v_pattern escape E'\\')
   and (p_before_date is null or (d.entry_date,d.id)<(p_before_date,p_before_id))
  order by d.entry_date desc,d.id desc limit 41
 ), items as (select * from page order by entry_date desc,id desc limit 40)
 select jsonb_build_object(
  'entries',coalesce((select jsonb_agg(jsonb_build_object('id',i.id::text,'title',i.title,'entry_date',i.entry_date,
   'created_at',i.created_at,'updated_at',i.updated_at,'preview',i.preview,'truncated',i.truncated)
   order by i.entry_date desc,i.id desc) from items i),'[]'::jsonb),
  'has_more',(select count(*)>40 from page),
  'stats',(select jsonb_build_object('total',count(*),'today',count(*) filter(where entry_date=p_today),
   'month',count(*) filter(where entry_date>=date_trunc('month',p_today::timestamp)::date and entry_date<(date_trunc('month',p_today::timestamp)+interval '1 month')::date))
   from public.diary_entries where user_id=v_owner)
 ) into v_result;
 return v_result;
end $$;
revoke all on function public.get_my_diary_page(text,text,date,bigint,date) from public,anon;
grant execute on function public.get_my_diary_page(text,text,date,bigint,date) to authenticated;

create or replace function public.export_my_diary_page(p_after_id bigint default 0,p_max_id bigint default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_owner uuid := (select auth.uid()); v_max bigint; v_result jsonb;
begin
 if v_owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_after_id is null or p_after_id<0 then raise exception 'Invalid cursor' using errcode='22023'; end if;
 select coalesce(p_max_id,max(id),0) into v_max from public.diary_entries where user_id=v_owner;
 with page as materialized (
  select id,title,content,entry_date,created_at,updated_at from public.diary_entries
  where user_id=v_owner and id>p_after_id and id<=v_max order by id limit 101
 ), items as (select * from page order by id limit 100)
 select jsonb_build_object('entries',coalesce((select jsonb_agg(jsonb_build_object('title',title,'content',content,
  'entry_date',entry_date,'created_at',created_at,'updated_at',updated_at) order by id) from items),'[]'::jsonb),
  'has_more',(select count(*)>100 from page),'next_id',(select max(id)::text from items),'max_id',v_max::text)
 into v_result;
 return v_result;
end $$;
revoke all on function public.export_my_diary_page(bigint,bigint) from public,anon;
grant execute on function public.export_my_diary_page(bigint,bigint) to authenticated;

create or replace function public.import_my_diary_entries(p_entries jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_owner uuid := (select auth.uid()); v_item jsonb; v_date date; v_added integer;
begin
 if v_owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_entries is null or jsonb_typeof(p_entries)<>'array' then
  raise exception 'Invalid backup' using errcode='22023'; end if;
 if jsonb_array_length(p_entries) not between 1 and 100 or octet_length(p_entries::text)>9000000 then
  raise exception 'Backup batch too large' using errcode='22023'; end if;
 for v_item in select value from jsonb_array_elements(p_entries) loop
  if jsonb_typeof(v_item)<>'object' or jsonb_typeof(v_item->'title') is distinct from 'string'
   or jsonb_typeof(v_item->'content') is distinct from 'string' or jsonb_typeof(v_item->'entry_date') is distinct from 'string'
   or char_length(btrim(v_item->>'title')) not between 1 and 120
   or char_length(btrim(v_item->>'content')) not between 1 and 20000
   or (v_item->>'entry_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
   raise exception 'Invalid backup entry' using errcode='22023'; end if;
  v_date := (v_item->>'entry_date')::date;
  if to_char(v_date,'YYYY-MM-DD')<>v_item->>'entry_date' then raise exception 'Invalid date' using errcode='22023'; end if;
 end loop;
 -- Serialize imports by owner; retries are safe and cannot change another owner's notes.
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text,0));
 with source as (select distinct btrim(value->>'title') as title,btrim(value->>'content') as content,
  (value->>'entry_date')::date as entry_date from jsonb_array_elements(p_entries))
 insert into public.diary_entries(user_id,title,content,entry_date)
 select v_owner,s.title,s.content,s.entry_date from source s
 where not exists (select 1 from public.diary_entries d where d.user_id=v_owner
  and d.entry_date=s.entry_date and d.title=s.title and d.content=s.content);
 get diagnostics v_added=row_count;
 return jsonb_build_object('inserted',v_added,'skipped',jsonb_array_length(p_entries)-v_added);
end $$;
revoke all on function public.import_my_diary_entries(jsonb) from public,anon;
grant execute on function public.import_my_diary_entries(jsonb) to authenticated;
