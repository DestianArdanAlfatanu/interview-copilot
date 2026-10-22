-- CreateTable
CREATE TABLE `cv_profiles` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `file_path` VARCHAR(512) NULL,
    `extracted_text` MEDIUMTEXT NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobs` (
    `id` CHAR(36) NOT NULL,
    `company` VARCHAR(191) NOT NULL,
    `position` VARCHAR(191) NOT NULL,
    `description` MEDIUMTEXT NOT NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prep_analyses` (
    `id` CHAR(36) NOT NULL,
    `cv_id` CHAR(36) NOT NULL,
    `job_id` CHAR(36) NOT NULL,
    `model` VARCHAR(64) NOT NULL,
    `match_json` JSON NULL,
    `answer_bank_json` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `input_tokens` INTEGER NOT NULL DEFAULT 0,
    `output_tokens` INTEGER NOT NULL DEFAULT 0,
    `cost_usd` DECIMAL(10, 6) NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `prep_analyses_cv_id_job_id_idx`(`cv_id`, `job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` CHAR(36) NOT NULL,
    `cv_id` CHAR(36) NOT NULL,
    `job_id` CHAR(36) NOT NULL,
    `prep_id` CHAR(36) NULL,
    `language` VARCHAR(4) NOT NULL,
    `answer_format` VARCHAR(16) NOT NULL,
    `answer_length` VARCHAR(16) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'setup',
    `started_at` DATETIME(3) NULL,
    `ended_at` DATETIME(3) NULL,
    `stt_seconds_hr` INTEGER NOT NULL DEFAULT 0,
    `stt_seconds_user` INTEGER NOT NULL DEFAULT 0,
    `stt_cost_usd` DECIMAL(10, 6) NOT NULL DEFAULT 0,
    `llm_cost_usd` DECIMAL(10, 6) NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `utterances` (
    `id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `speaker` VARCHAR(8) NOT NULL,
    `text` TEXT NOT NULL,
    `start_ms` INTEGER NOT NULL,
    `end_ms` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `utterances_session_id_start_ms_idx`(`session_id`, `start_ms`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `answers` (
    `id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `utterance_ids` JSON NULL,
    `question_text` TEXT NOT NULL,
    `answer_text` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `out_of_cv` BOOLEAN NOT NULL DEFAULT false,
    `rating` INTEGER NULL,
    `latency_json` JSON NULL,
    `input_tokens` INTEGER NOT NULL DEFAULT 0,
    `cached_tokens` INTEGER NOT NULL DEFAULT 0,
    `output_tokens` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `answers_session_id_created_at_idx`(`session_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settings` (
    `key` VARCHAR(64) NOT NULL,
    `value` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `prep_analyses` ADD CONSTRAINT `prep_analyses_cv_id_fkey` FOREIGN KEY (`cv_id`) REFERENCES `cv_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prep_analyses` ADD CONSTRAINT `prep_analyses_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_cv_id_fkey` FOREIGN KEY (`cv_id`) REFERENCES `cv_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_prep_id_fkey` FOREIGN KEY (`prep_id`) REFERENCES `prep_analyses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `utterances` ADD CONSTRAINT `utterances_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `answers` ADD CONSTRAINT `answers_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
