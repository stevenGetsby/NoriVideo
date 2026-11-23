# TGG 画布分辨率热修（2026-11-18）

- 现象：画布给 `nori::tgg-seedance2.5` 发送 `resolution: "480p"`，但 TGG Full 的配置不开放分辨率选项，提交在入队前返回 `CAPABILITY_FIELD_INVALID`。
- 修复：画布对未提供分辨率选项的 TGG 模型显示默认分辨率，报价和生成提交不再携带 `resolution`；服务端清除缓存客户端仍发送的分辨率。其他模型的分辨率校验和 TGG 的比例、时长、参考素材规则保持不变。
- 基线：线上 `20261117-cgtid-view`（`fd503222…`）。只叠加画布生成器、画布提交、共享生成端点和回归测试四个文件，不包含其他工作区改动。
- 发布：`/opt/norivideo/releases/20261118-tgg-resolution`，镜像 `norivideo:release-20261118-tgg-resolution`（`sha256:5d68a19f…`），源码指纹 `d550e29f…`。16:13–16:14（北京时间）切换，切换前无活动生成任务。
- 验证：旧请求复现 400，补丁后通过校验并进入测试队列；本地浏览器验证不显示分辨率选择、不发送该字段，保留 30 秒。线上主站及管理端健康，登录页均返回 200，TOS guard 和上传／读取／删除通过，受保护配置逐字节不变，数据库 schema 无变更。
- 回滚：上一镜像 `norivideo:release-20261117-cgtid-view`；备份位于 `/opt/norivideo/backups/20261118-tgg-resolution`。只回滚 app/admin 镜像，不回写业务数据库。
