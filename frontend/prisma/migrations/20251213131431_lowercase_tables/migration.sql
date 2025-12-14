/*
  Warnings:

  - You are about to drop the `Proxy` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Worker` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `Proxy` DROP FOREIGN KEY `Proxy_workerId_fkey`;

-- DropTable
DROP TABLE `Proxy`;

-- DropTable
DROP TABLE `Worker`;

-- CreateTable
CREATE TABLE `worker` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NOT NULL,
    `port` INTEGER NOT NULL,
    `apiKey` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OFFLINE',
    `lastSeen` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `worker_apiKey_key`(`apiKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `proxy` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `port` INTEGER NOT NULL,
    `authUser` VARCHAR(191) NULL,
    `authPass` VARCHAR(191) NULL,
    `modemInterface` VARCHAR(191) NOT NULL,
    `workerId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `proxy_port_key`(`port`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `proxy` ADD CONSTRAINT `proxy_workerId_fkey` FOREIGN KEY (`workerId`) REFERENCES `worker`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
