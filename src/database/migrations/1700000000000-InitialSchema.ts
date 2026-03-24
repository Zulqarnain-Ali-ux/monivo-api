import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Enable UUID extension
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // Users
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"                  UUID        NOT NULL DEFAULT gen_random_uuid(),
        "email"               VARCHAR(255) NOT NULL,
        "password_hash"       VARCHAR(255) NOT NULL,
        "fname"               VARCHAR(100) NOT NULL,
        "lname"               VARCHAR(100),
        "initials"            VARCHAR(10),
        "email_verified"      BOOLEAN      NOT NULL DEFAULT false,
        "is_active"           BOOLEAN      NOT NULL DEFAULT true,
        "refresh_token_hash"  TEXT,
        "created_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_users" PRIMARY KEY ("id"),
        CONSTRAINT "uq_users_email" UNIQUE ("email")
      )
    `);

    // Income
    await queryRunner.query(`
      CREATE TABLE "income" (
        "id"           UUID           NOT NULL DEFAULT gen_random_uuid(),
        "user_id"      UUID           NOT NULL,
        "salary"       NUMERIC(10,2)  NOT NULL DEFAULT 0,
        "side"         NUMERIC(10,2)  NOT NULL DEFAULT 0,
        "passive"      NUMERIC(10,2)  NOT NULL DEFAULT 0,
        "savings_goal" NUMERIC(10,2)  NOT NULL DEFAULT 0,
        "invest_goal"  NUMERIC(10,2)  NOT NULL DEFAULT 0,
        "updated_at"   TIMESTAMPTZ    NOT NULL DEFAULT now(),
        CONSTRAINT "pk_income"        PRIMARY KEY ("id"),
        CONSTRAINT "uq_income_user"   UNIQUE ("user_id"),
        CONSTRAINT "fk_income_user"   FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // Budget categories
    await queryRunner.query(`
      CREATE TABLE "budget_categories" (
        "id"         UUID           NOT NULL DEFAULT gen_random_uuid(),
        "user_id"    UUID           NOT NULL,
        "cat_id"     VARCHAR(50)    NOT NULL,
        "name"       VARCHAR(100)   NOT NULL,
        "group_type" VARCHAR(20)    NOT NULL,
        "cat_key"    VARCHAR(100),
        "amount"     NUMERIC(10,2)  NOT NULL DEFAULT 0,
        "icon"       VARCHAR(10),
        "sort_order" INTEGER        NOT NULL DEFAULT 0,
        "is_default" BOOLEAN        NOT NULL DEFAULT false,
        "updated_at" TIMESTAMPTZ    NOT NULL DEFAULT now(),
        CONSTRAINT "pk_budget_categories" PRIMARY KEY ("id"),
        CONSTRAINT "fk_budget_categories_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_budget_categories_user" ON "budget_categories"("user_id")`);

    // Entries
    await queryRunner.query(`
      CREATE TABLE "entries" (
        "id"                    UUID           NOT NULL DEFAULT gen_random_uuid(),
        "user_id"               UUID           NOT NULL,
        "amount"                NUMERIC(10,2)  NOT NULL,
        "category"              VARCHAR(100)   NOT NULL,
        "entry_date"            DATE           NOT NULL,
        "entry_ts"              BIGINT         NOT NULL,
        "note"                  VARCHAR(500)   NOT NULL DEFAULT '',
        "plaid_transaction_id"  VARCHAR(255)   UNIQUE,
        "created_at"            TIMESTAMPTZ    NOT NULL DEFAULT now(),
        CONSTRAINT "pk_entries" PRIMARY KEY ("id"),
        CONSTRAINT "fk_entries_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_entries_user_date" ON "entries"("user_id", "entry_date")`);

    // Streaks
    await queryRunner.query(`
      CREATE TABLE "streaks" (
        "user_id"    UUID        NOT NULL,
        "days"       INTEGER     NOT NULL DEFAULT 0,
        "last_log"   DATE,
        "grace_used" BOOLEAN     NOT NULL DEFAULT false,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_streaks" PRIMARY KEY ("user_id"),
        CONSTRAINT "fk_streaks_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // Goals
    await queryRunner.query(`
      CREATE TABLE "goals" (
        "id"         UUID           NOT NULL DEFAULT gen_random_uuid(),
        "user_id"    UUID           NOT NULL,
        "name"       VARCHAR(200)   NOT NULL,
        "target"     NUMERIC(12,2)  NOT NULL,
        "saved"      NUMERIC(12,2)  NOT NULL DEFAULT 0,
        "goal_type"  VARCHAR(30)    NOT NULL DEFAULT 'other',
        "created_at" TIMESTAMPTZ    NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ    NOT NULL DEFAULT now(),
        CONSTRAINT "pk_goals" PRIMARY KEY ("id"),
        CONSTRAINT "fk_goals_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // Plaid items
    await queryRunner.query(`
      CREATE TABLE "plaid_items" (
        "id"                      UUID        NOT NULL DEFAULT gen_random_uuid(),
        "user_id"                 UUID        NOT NULL,
        "plaid_item_id"           VARCHAR     NOT NULL,
        "access_token_encrypted"  TEXT        NOT NULL,
        "institution_id"          VARCHAR,
        "institution_name"        VARCHAR,
        "cursor"                  TEXT,
        "last_synced_at"          TIMESTAMPTZ,
        "is_active"               BOOLEAN     NOT NULL DEFAULT true,
        "created_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_plaid_items"          PRIMARY KEY ("id"),
        CONSTRAINT "uq_plaid_items_item_id"  UNIQUE ("plaid_item_id"),
        CONSTRAINT "fk_plaid_items_user"     FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_plaid_items_user" ON "plaid_items"("user_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "plaid_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "goals"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "streaks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "budget_categories"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "income"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
