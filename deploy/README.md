# deploy/ 目录状态

NoriVideo 现在只有一个在役生产服务器：备案机 `14.103.65.61`（`lanmiaoai.com`）。

本目录保存的是早期环境的服务器配置副本，**备案机的发布流程不读取本目录**，其中指向旧机器的文件已全部退役，不要再应用到任何服务器。

| 文件 | 归属环境 | 状态 |
| --- | --- | --- |
| `nginx-heblm.conf` | 退役机 `118.196.6.130`（`heblm.com` / `118-196-6-130.sslip.io`） | 退役，不得访问 |
| `com.norivideo.ghc-tunnel.plist` | 退役机 `118.196.6.130` | 退役，不得访问 |
| `nginx-lanmiao-test.conf` | 退役机 `45.76.215.9`（`lanmiao-test.xyz`） | 退役 |
| `nginx-lanmiao-test-bootstrap.conf` | 退役机 `45.76.215.9`（`lanmiao-test.xyz`） | 退役 |
| `com.norivideo.ghc-tunnel-vultr.plist` | 退役机 `45.76.215.9` | 退役 |
| `norivideo-ghc-proxy.service` | 与主机无关（容器到宿主机的 GHC 桥接） | 仍可用 |
| `norivideo-backup.cron` | 通用备份任务（`/opt/norivideo`） | 仍可用 |
| `certbot-pythonpath.conf` | 通用 certbot 配置片段 | 仍可用 |

备案机上的 nginx / TLS 配置位于服务器本机，不在本仓库内。发布方式为「镜像 + 应用产物 + `/opt/norivideo` 下的受保护配置」，目标与流程记录见 `docs/deployments/`，目标机规则见仓库根目录 `AGENTS.md`。
