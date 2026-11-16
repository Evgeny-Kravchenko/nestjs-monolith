import { MigrationInterface, QueryRunner } from 'typeorm';

// down() drops both tables and enums: one-way for data (registered users are lost on revert).
export class CreateUsersAndRegistrationChallenges1794766926338 implements MigrationInterface {
  name = 'CreateUsersAndRegistrationChallenges1794766926338';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."users_status_enum" AS ENUM('pending', 'active')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "email" character varying(254) NOT NULL, "password_hash" character varying(255) NOT NULL, "status" "public"."users_status_enum" NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_users_email" ON "users" ("email") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."registration_challenges_method_enum" AS ENUM('otp', 'magic_link')`,
    );
    await queryRunner.query(
      `CREATE TABLE "registration_challenges" ("id" uuid NOT NULL, "user_id" uuid NOT NULL, "method" "public"."registration_challenges_method_enum" NOT NULL, "secret_hash" character(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "last_sent_at" TIMESTAMP WITH TIME ZONE, "attempts" smallint NOT NULL DEFAULT '0', "consumed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_registration_challenges_attempts" CHECK (attempts BETWEEN 0 AND 5), CONSTRAINT "PK_d6fa191ff3d39187fdd4f889406" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_registration_challenges_magic_link_secret" ON "registration_challenges" ("secret_hash") WHERE method = 'magic_link'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_registration_challenges_user_id" ON "registration_challenges" ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "registration_challenges" ADD CONSTRAINT "FK_518c0664929d6d414210cd2ac30" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "registration_challenges" DROP CONSTRAINT "FK_518c0664929d6d414210cd2ac30"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_registration_challenges_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_registration_challenges_magic_link_secret"`,
    );
    await queryRunner.query(`DROP TABLE "registration_challenges"`);
    await queryRunner.query(
      `DROP TYPE "public"."registration_challenges_method_enum"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_users_email"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_status_enum"`);
  }
}
