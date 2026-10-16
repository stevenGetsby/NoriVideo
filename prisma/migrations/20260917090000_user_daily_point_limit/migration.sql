-- 每个用户每天的用量上限（积分，100 积分 = ¥1）。NULL 表示不限制。
ALTER TABLE `user` ADD COLUMN `dailyPointLimit` INTEGER NULL;
