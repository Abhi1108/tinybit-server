-- Doctors catalog for Book Appointment (public read-only catalog)

create table if not exists public.doctors (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  specialty   text        not null,
  rating      numeric(2,1) not null default 4.5
                           check (rating >= 0 and rating <= 5),
  experience  text        not null,
  fee         text        not null,
  address     text,
  image_url   text,
  is_active   boolean     not null default true,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint doctors_name_specialty_unique unique (name, specialty)
);

create index if not exists doctors_specialty_active_sort_idx
  on public.doctors (specialty, is_active, sort_order);

drop trigger if exists doctors_updated_at on public.doctors;
create trigger doctors_updated_at
  before update on public.doctors
  for each row execute function public.set_updated_at();

alter table public.doctors enable row level security;

drop policy if exists "doctors_select_active" on public.doctors;
create policy "doctors_select_active"
  on public.doctors
  for select
  using (is_active = true);

-- Seed from TinyBit v2 book-appointment hardcoded catalog
insert into public.doctors
  (id, name, specialty, rating, experience, fee, address, sort_order)
values
  ('a1000001-0001-4000-8000-000000000001', 'Dr. Arjun Mehta',  'General Physician', 4.8, '15 yrs', '₹400', 'Apollo Clinic, Andheri West, Mumbai',        1),
  ('a1000001-0001-4000-8000-000000000002', 'Dr. Sunita Rao',   'General Physician', 4.6, '10 yrs', '₹350', 'City Health Centre, Bandra, Mumbai',       2),
  ('a1000001-0001-4000-8000-000000000003', 'Dr. Priya Sharma', 'Cardiologist',      4.9, '20 yrs', '₹700', 'Heart Care Hospital, Powai, Mumbai',         1),
  ('a1000001-0001-4000-8000-000000000004', 'Dr. Vikram Singh', 'Cardiologist',      4.7, '12 yrs', '₹600', 'Lilavati Hospital, Bandra, Mumbai',        2),
  ('a1000001-0001-4000-8000-000000000005', 'Dr. Neha Patel',   'Orthopedic',        4.8, '18 yrs', '₹500', 'Bone & Joint Clinic, Goregaon, Mumbai',      1),
  ('a1000001-0001-4000-8000-000000000006', 'Dr. Raj Kumar',    'Orthopedic',        4.5, '8 yrs',  '₹450', 'Sports Med Centre, Malad, Mumbai',           2),
  ('a1000001-0001-4000-8000-000000000007', 'Dr. Anita Desai',  'Neurologist',       4.9, '22 yrs', '₹800', 'Neuro Institute, Dadar, Mumbai',             1),
  ('a1000001-0001-4000-8000-000000000008', 'Dr. Suresh Nair',  'Ophthalmologist',   4.7, '14 yrs', '₹500', 'Vision Eye Hospital, Thane',                 1),
  ('a1000001-0001-4000-8000-000000000009', 'Dr. Meera Joshi',  'Dentist',           4.6, '9 yrs',  '₹300', 'Smile Dental Studio, Vile Parle, Mumbai',    1)
on conflict on constraint doctors_name_specialty_unique do nothing;
