-- v60: Form báo cáo (P3) — schema ai_management
-- Form tạo qua hội thoại, phát hành theo phiên bản bất biến, gán từng nhân viên
-- với deadline, nộp qua DM, tổng hợp và đánh giá rubric.

CREATE SEQUENCE IF NOT EXISTS ai_management.form_display_code_seq START 101;

-- 1. Mẫu form: bản nháp do quản lý tạo qua hội thoại
CREATE TABLE IF NOT EXISTS ai_management.report_form_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    display_code INTEGER NOT NULL DEFAULT nextval('ai_management.form_display_code_seq'),
    title VARCHAR NOT NULL,
    description TEXT,
    rubric JSONB NOT NULL DEFAULT '[]'::jsonb, -- danh sách tiêu chí đánh giá
    draft_fields JSONB NOT NULL DEFAULT '[]'::jsonb, -- cấu trúc trường đang soạn
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_form_templates_owner
    ON ai_management.report_form_templates(created_by, status);

-- 2. Phiên bản form: cấu trúc trường KHÔNG ĐỔI sau khi phát hành (mục 25.3)
CREATE TABLE IF NOT EXISTS ai_management.report_form_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID NOT NULL REFERENCES ai_management.report_form_templates(id) ON DELETE CASCADE,
    version_no INTEGER NOT NULL,
    fields JSONB NOT NULL, -- [{key,label,type,required,options}]
    published_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    published_by VARCHAR(64) NOT NULL,
    UNIQUE(template_id, version_no)
);

-- 3. Gán form cho nhân viên (1 bản/template/người, trạng thái riêng từng người)
CREATE TABLE IF NOT EXISTS ai_management.report_form_assignments (
    id BIGSERIAL PRIMARY KEY,
    template_id UUID NOT NULL REFERENCES ai_management.report_form_templates(id) ON DELETE CASCADE,
    version_id UUID NOT NULL REFERENCES ai_management.report_form_versions(id),
    employee_id UUID REFERENCES employees(id),
    employee_code_snapshot VARCHAR,
    employee_name_snapshot VARCHAR,
    telegram_user_id_snapshot VARCHAR NOT NULL,
    due_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'SUBMITTED', 'CANCELLED')),
    last_reminded_on DATE,                    -- chống nhắc lặp trong ngày
    overdue_manager_notified_at TIMESTAMP WITH TIME ZONE,
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(template_id, telegram_user_id_snapshot)
);

CREATE INDEX IF NOT EXISTS idx_report_form_assignments_open
    ON ai_management.report_form_assignments(status, due_at);

-- 4. Bài nộp: một assignment có tối đa một bài nộp
CREATE TABLE IF NOT EXISTS ai_management.report_submissions (
    id BIGSERIAL PRIMARY KEY,
    assignment_id BIGINT NOT NULL UNIQUE
        REFERENCES ai_management.report_form_assignments(id) ON DELETE CASCADE,
    version_id UUID NOT NULL REFERENCES ai_management.report_form_versions(id),
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_late BOOLEAN NOT NULL DEFAULT false,
    evaluation JSONB, -- {criteria:[{label,score}], comment}
    evaluation_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (evaluation_status IN ('PENDING', 'EVALUATED')),
    evaluated_at TIMESTAMP WITH TIME ZONE,
    evaluated_by VARCHAR(64)
);

-- Mở rộng giá trị outbox đã tạo ở v59: thêm loại định hướng reply cho form
-- (direction CHECK của task_message_links là ràng buộc sẵn có — kiểm tra tên
-- ràng buộc rồi nới). Không đụng dữ liệu cũ.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'task_message_links_direction_check'
          AND conrelid = 'ai_management.task_message_links'::regclass
    ) THEN
        ALTER TABLE ai_management.task_message_links
            DROP CONSTRAINT task_message_links_direction_check;
        ALTER TABLE ai_management.task_message_links
            ADD CONSTRAINT task_message_links_direction_check
            CHECK (direction IN (
                'EMPLOYEE_TASK', 'MANAGER_REVIEW', 'MANAGER_COMMENT', 'EMPLOYEE_COMMENT',
                'FORM_FILL', 'FORM_EVAL'
            ));
    END IF;
END $$;
