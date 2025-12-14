/*
  Warnings:

  - You are about to drop the column `authPass` on the `proxy` table. All the data in the column will be lost.
  - You are about to drop the column `authUser` on the `proxy` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `proxy` table. All the data in the column will be lost.
  - You are about to drop the column `modemInterface` on the `proxy` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `proxy` table. All the data in the column will be lost.
  - You are about to drop the column `workerId` on the `proxy` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `apiKey` on the `worker` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `worker` table. All the data in the column will be lost.
  - You are about to drop the column `lastSeen` on the `worker` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `worker` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[api_key]` on the table `worker` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `modem_interface` to the `proxy` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `proxy` table without a default value. This is not possible if the table is not empty.
  - Added the required column `worker_id` to the `proxy` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `user` table without a default value. This is not possible if the table is not empty.
  - Added the required column `api_key` to the `worker` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `worker` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `proxy` DROP FOREIGN KEY `proxy_workerId_fkey`;

-- DropIndex
DROP INDEX `worker_apiKey_key` ON `worker`;

-- Rename Columns User
ALTER TABLE `user` RENAME COLUMN `createdAt` TO `created_at`;
ALTER TABLE `user` RENAME COLUMN `updatedAt` TO `updated_at`;

-- Rename Columns Worker
ALTER TABLE `worker` RENAME COLUMN `apiKey` TO `api_key`;
ALTER TABLE `worker` RENAME COLUMN `createdAt` TO `created_at`;
ALTER TABLE `worker` RENAME COLUMN `updatedAt` TO `updated_at`;
ALTER TABLE `worker` RENAME COLUMN `lastSeen` TO `last_seen`;

-- Rename Columns Proxy
ALTER TABLE `proxy` RENAME COLUMN `authUser` TO `auth_user`;
ALTER TABLE `proxy` RENAME COLUMN `authPass` TO `auth_pass`;
ALTER TABLE `proxy` RENAME COLUMN `modemInterface` TO `modem_interface`;
ALTER TABLE `proxy` RENAME COLUMN `workerId` TO `worker_id`;
ALTER TABLE `proxy` RENAME COLUMN `createdAt` TO `created_at`;
ALTER TABLE `proxy` RENAME COLUMN `updatedAt` TO `updated_at`;

-- CreateIndex
CREATE UNIQUE INDEX `worker_api_key_key` ON `worker`(`api_key`);

-- AddForeignKey
ALTER TABLE `proxy` ADD CONSTRAINT `proxy_worker_id_fkey` FOREIGN KEY (`worker_id`) REFERENCES `worker`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
