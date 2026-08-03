-- Run first in the SQL Editor of the TEST project.
-- Record the single-row summary and the checksum before inserting fixtures.

select
  count(*) filter (
    where series_id is not null and occurrence_number is null
  ) as series_without_occurrence,
  count(*) filter (
    where occurrence_number is not null and series_id is null
  ) as occurrence_without_series,
  count(*) filter (
    where occurrence_number is not null and occurrence_number < 1
  ) as occurrence_lower_than_one,
  count(*) as total_future_bills,
  md5(
    coalesce(
      jsonb_agg(to_jsonb(bill) order by user_id, id),
      '[]'::jsonb
    )::text
  ) as future_bills_checksum
from public.future_bills as bill;

select
  user_id,
  series_id,
  occurrence_number,
  count(*) as duplicate_count
from public.future_bills
where series_id is not null
  and occurrence_number is not null
group by user_id, series_id, occurrence_number
having count(*) > 1
order by user_id, series_id, occurrence_number;

select count(*) as blank_series_id
from public.future_bills
where series_id is not null
  and btrim(series_id) = '';
