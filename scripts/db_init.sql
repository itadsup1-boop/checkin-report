-- ============================================================
-- scripts/db_init.sql — Khởi tạo Database telegram_kpi
-- Export từ production: 2026-07-18
-- ============================================================
-- Chạy lệnh: psql -U postgres -c "CREATE DATABASE telegram_kpi;" && \
--            psql -U postgres -d telegram_kpi -f scripts/db_init.sql
-- ============================================================

--
-- PostgreSQL database dump
--

\restrict ljNR8mRgJ3yfP2BJnmiEowOX0qR4ZQYfQskDpOPYU5Uo8oyQEN6vWE9avYrKHrJ

-- Dumped from database version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admins (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying NOT NULL,
    password_hash character varying NOT NULL,
    role character varying NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: customer_appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_appointments (
    id integer NOT NULL,
    telegram_id character varying(50),
    employee_name character varying(255),
    group_id character varying(50),
    customer_name character varying(255),
    phone character varying(50),
    service character varying(255),
    sessions character varying(50),
    appointment_time timestamp without time zone,
    is_reminded boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    cancel_reason text,
    sheet_row_index integer,
    revenue character varying(50)
);


--
-- Name: customer_appointments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_appointments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_appointments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_appointments_id_seq OWNED BY public.customer_appointments.id;


--
-- Name: daily_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_reports (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    report_date date NOT NULL,
    report_month character varying NOT NULL,
    employee_id uuid,
    telegram_group_id character varying,
    raw_text text,
    parsed_json jsonb,
    kpi_required numeric,
    kpi_actual numeric,
    kpi_unit character varying,
    kpi_missing numeric,
    completion_rate numeric,
    status character varying,
    submitted_at timestamp with time zone,
    is_late boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    metadata jsonb
);


--
-- Name: employee_kpi_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_kpi_overrides (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid,
    kpi_name character varying NOT NULL,
    kpi_required numeric NOT NULL,
    kpi_unit character varying NOT NULL,
    penalty_low_kpi numeric DEFAULT 0,
    penalty_missing_report numeric DEFAULT 0,
    penalty_late_report numeric DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_code character varying NOT NULL,
    full_name character varying NOT NULL,
    telegram_id character varying,
    telegram_username character varying,
    telegram_group_id character varying,
    department character varying NOT NULL,
    "position" character varying NOT NULL,
    need_report boolean DEFAULT true,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    current_kpi_target numeric DEFAULT 0
);


--
-- Name: group_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_settings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    telegram_group_id character varying,
    main_kpi_unit character varying DEFAULT 'khách'::character varying,
    remind_time_1 time without time zone,
    remind_time_2 time without time zone,
    remind_time_3 time without time zone,
    deadline_time time without time zone,
    auto_reminder_enabled boolean DEFAULT true,
    updated_at timestamp with time zone DEFAULT now(),
    penalty_per_photo numeric DEFAULT 100000,
    penalty_missing_report numeric DEFAULT 100000,
    penalty_missing_kpi numeric DEFAULT 100000,
    photo_deadline_minutes integer DEFAULT 30,
    default_kpi integer DEFAULT 40,
    shift_1_time time without time zone DEFAULT '08:00:00'::time without time zone,
    shift_2_time time without time zone DEFAULT '13:30:00'::time without time zone
);


--
-- Name: image_fingerprints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.image_fingerprints (
    id integer NOT NULL,
    employee_id uuid,
    telegram_file_id character varying(255) NOT NULL,
    phash character varying(64) NOT NULL,
    report_date date NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: image_fingerprints_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.image_fingerprints_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: image_fingerprints_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.image_fingerprints_id_seq OWNED BY public.image_fingerprints.id;


--
-- Name: kpi_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_policies (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    telegram_group_id character varying,
    department character varying NOT NULL,
    "position" character varying NOT NULL,
    kpi_name character varying NOT NULL,
    kpi_required numeric NOT NULL,
    kpi_unit character varying NOT NULL,
    penalty_low_kpi numeric DEFAULT 0,
    penalty_missing_report numeric DEFAULT 0,
    penalty_late_report numeric DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: penalty_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.penalty_records (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    report_date date NOT NULL,
    report_month character varying NOT NULL,
    employee_id uuid,
    telegram_group_id character varying,
    reason character varying NOT NULL,
    kpi_required numeric,
    kpi_actual numeric,
    kpi_missing numeric,
    amount numeric DEFAULT 0,
    status character varying DEFAULT 'CHO_DUYET'::character varying,
    accounting_sheet_url text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: pending_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_reports (
    telegram_id character varying(50) NOT NULL,
    group_id character varying(50),
    raw_text text,
    kpi_actual integer,
    required_photos integer DEFAULT 0,
    received_photos integer DEFAULT 0,
    deadline_at timestamp without time zone NOT NULL,
    status character varying(20) DEFAULT 'WAITING_PHOTOS'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_reminder_stage integer DEFAULT 0,
    customers_data jsonb
);


--
-- Name: reminder_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reminder_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    report_date date NOT NULL,
    employee_id uuid,
    telegram_group_id character varying,
    reminder_no integer,
    send_type character varying,
    sent_at timestamp with time zone DEFAULT now()
);


--
-- Name: schedule_notification_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_notification_groups (
    group_id character varying(50) NOT NULL,
    group_name character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: telegram_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_groups (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    telegram_group_id character varying NOT NULL,
    group_name character varying NOT NULL,
    report_keyword character varying DEFAULT '#baocao'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: telegram_workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_workflows (
    group_id character varying(50) NOT NULL,
    command_trigger character varying(50) NOT NULL,
    is_photo_required boolean DEFAULT false,
    photo_deadline_minutes integer DEFAULT 120,
    is_revenue_required boolean DEFAULT false,
    is_appointment_required boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: tk_check_ins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tk_check_ins (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    group_id uuid,
    user_id uuid,
    date date NOT NULL,
    check_in_time timestamp with time zone NOT NULL,
    video_file_id character varying NOT NULL,
    status character varying DEFAULT 'PENDING'::character varying,
    admin_note text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: tk_group_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tk_group_settings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    telegram_group_id character varying NOT NULL,
    remind_time_1 time without time zone,
    auto_reminder_enabled boolean,
    photo_deadline_minutes integer,
    penalty_missing_kpi integer,
    penalty_per_photo integer,
    penalty_missing_report integer,
    shift_1_time time without time zone,
    shift_2_time time without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: tk_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tk_groups (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    telegram_group_id character varying NOT NULL,
    group_name character varying,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: tk_leave_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tk_leave_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid,
    user_id uuid,
    request_type character varying(30) NOT NULL,
    late_minutes integer DEFAULT 0,
    date date NOT NULL,
    reason text NOT NULL,
    proof_url character varying,
    status character varying(20) DEFAULT 'PENDING'::character varying,
    approved_by character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: tk_penalties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tk_penalties (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    group_id uuid,
    user_id uuid,
    date date NOT NULL,
    violation_type character varying NOT NULL,
    late_minutes integer,
    amount integer DEFAULT 0 NOT NULL,
    reason text,
    is_paid boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: tk_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tk_reports (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    group_id uuid,
    user_id uuid,
    date date NOT NULL,
    report_type character varying NOT NULL,
    reported_at timestamp with time zone NOT NULL,
    reason text,
    is_valid boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: tk_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tk_schedules (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    group_id uuid,
    user_id uuid,
    date date NOT NULL,
    shift_type character varying NOT NULL,
    is_locked boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    proof_url character varying,
    updated_by character varying(100),
    updated_at timestamp with time zone
);


--
-- Name: tk_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tk_users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    group_id uuid,
    telegram_id character varying NOT NULL,
    full_name character varying NOT NULL,
    role character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    leave_quota integer DEFAULT 12
);


--
-- Name: customer_appointments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_appointments ALTER COLUMN id SET DEFAULT nextval('public.customer_appointments_id_seq'::regclass);


--
-- Name: image_fingerprints id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_fingerprints ALTER COLUMN id SET DEFAULT nextval('public.image_fingerprints_id_seq'::regclass);


--
-- Name: admins admins_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_email_key UNIQUE (email);


--
-- Name: admins admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (id);


--
-- Name: customer_appointments customer_appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_appointments
    ADD CONSTRAINT customer_appointments_pkey PRIMARY KEY (id);


--
-- Name: daily_reports daily_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_reports
    ADD CONSTRAINT daily_reports_pkey PRIMARY KEY (id);


--
-- Name: employee_kpi_overrides employee_kpi_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_kpi_overrides
    ADD CONSTRAINT employee_kpi_overrides_pkey PRIMARY KEY (id);


--
-- Name: employees employees_employee_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_employee_code_key UNIQUE (employee_code);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: group_settings group_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_settings
    ADD CONSTRAINT group_settings_pkey PRIMARY KEY (id);


--
-- Name: image_fingerprints image_fingerprints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_fingerprints
    ADD CONSTRAINT image_fingerprints_pkey PRIMARY KEY (id);


--
-- Name: kpi_policies kpi_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_policies
    ADD CONSTRAINT kpi_policies_pkey PRIMARY KEY (id);


--
-- Name: penalty_records penalty_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.penalty_records
    ADD CONSTRAINT penalty_records_pkey PRIMARY KEY (id);


--
-- Name: pending_reports pending_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_reports
    ADD CONSTRAINT pending_reports_pkey PRIMARY KEY (telegram_id);


--
-- Name: reminder_logs reminder_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_logs
    ADD CONSTRAINT reminder_logs_pkey PRIMARY KEY (id);


--
-- Name: schedule_notification_groups schedule_notification_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_notification_groups
    ADD CONSTRAINT schedule_notification_groups_pkey PRIMARY KEY (group_id);


--
-- Name: telegram_groups telegram_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_groups
    ADD CONSTRAINT telegram_groups_pkey PRIMARY KEY (id);


--
-- Name: telegram_groups telegram_groups_telegram_group_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_groups
    ADD CONSTRAINT telegram_groups_telegram_group_id_key UNIQUE (telegram_group_id);


--
-- Name: telegram_workflows telegram_workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_workflows
    ADD CONSTRAINT telegram_workflows_pkey PRIMARY KEY (group_id);


--
-- Name: tk_check_ins tk_check_ins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_check_ins
    ADD CONSTRAINT tk_check_ins_pkey PRIMARY KEY (id);


--
-- Name: tk_group_settings tk_group_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_group_settings
    ADD CONSTRAINT tk_group_settings_pkey PRIMARY KEY (id);


--
-- Name: tk_groups tk_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_groups
    ADD CONSTRAINT tk_groups_pkey PRIMARY KEY (id);


--
-- Name: tk_groups tk_groups_telegram_group_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_groups
    ADD CONSTRAINT tk_groups_telegram_group_id_key UNIQUE (telegram_group_id);


--
-- Name: tk_leave_requests tk_leave_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_leave_requests
    ADD CONSTRAINT tk_leave_requests_pkey PRIMARY KEY (id);


--
-- Name: tk_penalties tk_penalties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_penalties
    ADD CONSTRAINT tk_penalties_pkey PRIMARY KEY (id);


--
-- Name: tk_reports tk_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_reports
    ADD CONSTRAINT tk_reports_pkey PRIMARY KEY (id);


--
-- Name: tk_schedules tk_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_schedules
    ADD CONSTRAINT tk_schedules_pkey PRIMARY KEY (id);


--
-- Name: tk_schedules tk_schedules_user_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_schedules
    ADD CONSTRAINT tk_schedules_user_id_date_key UNIQUE (user_id, date);


--
-- Name: tk_users tk_users_group_id_telegram_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_users
    ADD CONSTRAINT tk_users_group_id_telegram_id_key UNIQUE (group_id, telegram_id);


--
-- Name: tk_users tk_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_users
    ADD CONSTRAINT tk_users_pkey PRIMARY KEY (id);


--
-- Name: daily_reports daily_reports_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_reports
    ADD CONSTRAINT daily_reports_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: daily_reports daily_reports_telegram_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_reports
    ADD CONSTRAINT daily_reports_telegram_group_id_fkey FOREIGN KEY (telegram_group_id) REFERENCES public.telegram_groups(telegram_group_id);


--
-- Name: employee_kpi_overrides employee_kpi_overrides_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_kpi_overrides
    ADD CONSTRAINT employee_kpi_overrides_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: employees employees_telegram_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_telegram_group_id_fkey FOREIGN KEY (telegram_group_id) REFERENCES public.telegram_groups(telegram_group_id);


--
-- Name: group_settings group_settings_telegram_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_settings
    ADD CONSTRAINT group_settings_telegram_group_id_fkey FOREIGN KEY (telegram_group_id) REFERENCES public.telegram_groups(telegram_group_id);


--
-- Name: kpi_policies kpi_policies_telegram_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_policies
    ADD CONSTRAINT kpi_policies_telegram_group_id_fkey FOREIGN KEY (telegram_group_id) REFERENCES public.telegram_groups(telegram_group_id);


--
-- Name: penalty_records penalty_records_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.penalty_records
    ADD CONSTRAINT penalty_records_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: penalty_records penalty_records_telegram_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.penalty_records
    ADD CONSTRAINT penalty_records_telegram_group_id_fkey FOREIGN KEY (telegram_group_id) REFERENCES public.telegram_groups(telegram_group_id);


--
-- Name: reminder_logs reminder_logs_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_logs
    ADD CONSTRAINT reminder_logs_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: reminder_logs reminder_logs_telegram_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_logs
    ADD CONSTRAINT reminder_logs_telegram_group_id_fkey FOREIGN KEY (telegram_group_id) REFERENCES public.telegram_groups(telegram_group_id);


--
-- Name: tk_check_ins tk_check_ins_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_check_ins
    ADD CONSTRAINT tk_check_ins_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.tk_groups(id) ON DELETE CASCADE;


--
-- Name: tk_check_ins tk_check_ins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_check_ins
    ADD CONSTRAINT tk_check_ins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.tk_users(id) ON DELETE CASCADE;


--
-- Name: tk_group_settings tk_group_settings_telegram_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_group_settings
    ADD CONSTRAINT tk_group_settings_telegram_group_id_fkey FOREIGN KEY (telegram_group_id) REFERENCES public.tk_groups(telegram_group_id) ON DELETE CASCADE;


--
-- Name: tk_leave_requests tk_leave_requests_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_leave_requests
    ADD CONSTRAINT tk_leave_requests_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.tk_groups(id) ON DELETE CASCADE;


--
-- Name: tk_leave_requests tk_leave_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_leave_requests
    ADD CONSTRAINT tk_leave_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.tk_users(id) ON DELETE CASCADE;


--
-- Name: tk_penalties tk_penalties_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_penalties
    ADD CONSTRAINT tk_penalties_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.tk_groups(id) ON DELETE CASCADE;


--
-- Name: tk_penalties tk_penalties_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_penalties
    ADD CONSTRAINT tk_penalties_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.tk_users(id) ON DELETE CASCADE;


--
-- Name: tk_reports tk_reports_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_reports
    ADD CONSTRAINT tk_reports_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.tk_groups(id) ON DELETE CASCADE;


--
-- Name: tk_reports tk_reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_reports
    ADD CONSTRAINT tk_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.tk_users(id) ON DELETE CASCADE;


--
-- Name: tk_schedules tk_schedules_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_schedules
    ADD CONSTRAINT tk_schedules_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.tk_groups(id) ON DELETE CASCADE;


--
-- Name: tk_schedules tk_schedules_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_schedules
    ADD CONSTRAINT tk_schedules_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.tk_users(id) ON DELETE CASCADE;


--
-- Name: tk_users tk_users_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tk_users
    ADD CONSTRAINT tk_users_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.tk_groups(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict ljNR8mRgJ3yfP2BJnmiEowOX0qR4ZQYfQskDpOPYU5Uo8oyQEN6vWE9avYrKHrJ

