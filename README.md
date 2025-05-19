<!-- @import "[TOC]" {cmd="toc" depthFrom=1 depthTo=6 orderedList=false} -->

<!-- code_chunk_output -->

- [SSH Remote Metrics Collector for Categraf](#remote-ssh-metrics-collector-for-categraf)
  - [功能特性](#功能特性)
  - [快速开始](#快速开始)
    - [安装](#安装)
    - [命令行使用](#命令行使用)
  - [参数说明](#参数说明)
  - [输出指标示例](#输出指标示例)
  - [错误提示](#错误提示)
  - [Categraf 配置指南](#categraf-配置指南)
  - [许可证](#许可证)
  - [补充说明](#补充说明)

<!-- /code_chunk_output -->

# SSH Remote Metrics Collector for Categraf

通过 SSH 协议连接远程服务器，收集系统运行指标数据，并输出为 Categraf 监控系统兼容的指标格式。
目标是为夜莺（Nightingale）监控系统和 Categraf 采集器提供基于 SSH 连接的监控方式。

## 功能特性

1. 支持 SSH 协议连接远程服务器
2. 自动收集基础系统信息（内核版本/主机名/负载）
3. 收集 CPU/内存/磁盘/网络接口/文件系统等核心指标
4. 收集 TOP10 CPU/内存占用进程信息
5. 支持命令行参数和环境变量配置
6. 指标输出符合 categraf exec 插件可读取的格式, 支持使用 categraf exec 插件直接配置

## 快速开始

### 安装

自行编译或访问 Release 页面直接下载二进制文件，并执行

### 命令行使用

```bash
# 基础用法
remote-ssh --host 192.168.1.100 --port 22 --username admin --password Secret123 --labels monitor_id:1 tenant:foo

# 使用环境变量
export REMOTE_SSH_HOST=192.168.1.100
export REMOTE_SSH_PORT=22
export REMOTE_SSH_USERNAME=admin
export REMOTE_SSH_PASSWORD=Secret123
export REMOTE_SSH_LABELS=monitor_id:1 tenant:foo
remote-ssh
```

## 参数说明

| 参数          | 环境变量            | 默认值 | 描述                          |
| ------------- | ------------------- | ------ | ----------------------------- |
| --host -h     | REMOTE_SSH_HOST     | 必填   | 远程服务器地址                |
| --port -P     | REMOTE_SSH_PORT     | 22     | SSH 端口号                    |
| --username -u | REMOTE_SSH_USERNAME | 必填   | 登录用户名                    |
| --password -p | REMOTE_SSH_PASSWORD | 必填   | 登录密码                      |
| --labels -l   | REMOTE_SSH_LABELS   | 无     | 附加标签（格式：label:value） |

## 输出指标示例

```text
node_ssh_up{env="prod",host="web01",region="us-west"} 1
node_ssh_basic{env="prod",host="web01",region="us-west",version="5.4.0-124-generic",hostname="web01",uptime="12 days"} 1
node_ssh_cpu_cores{env="prod",host="web01",region="us-west"} 8
node_ssh_memory_total{env="prod",host="web01",region="us-west"} 16384
node_ssh_disk_num{env="prod",host="web01",region="us-west"} 1
node_ssh_interface_receive_bytes{env="prod",host="web01",region="us-west",interface="eth0"} 123456789
```

## 错误提示

如果连接目标主机失败，将会把错误信息输出在 node_ssh_up 指标的 msg 标签中

```
node_ssh_up{monitor_id="1",target="127.0.0.1:22",msg="Error: All configured authentication methods failed"} 0
```

## Categraf 配置指南

与 Categraf 采集器集成的主要原理是配置 [exec 插件](https://github.com/flashcatcloud/categraf/tree/main/inputs/exec), 参考以下代码，也可以

```
# input.exec/remote-ssh.toml
interval = 30
[[instances]]
commands = [
   "/var/categraf/scripts/ssh-1.sh",
]
timeout = 5
interval_times = 1
data_format = "prometheus"

[instances.scripts]
"/var/categraf/scripts/ssh-1.sh"='''
#!/bin/sh
export REMOTE_SSH_HOST=192.168.1.100
export REMOTE_SSH_PORT=22
export REMOTE_SSH_USERNAME=admin
export REMOTE_SSH_PASSWORD=Secret123
export REMOTE_SSH_LABELS=monitor_id:1 tenant:foo
/path/to/remote-ssh
'''

```

## 许可证

本项目采用 Apache-2.0 开源协议

## 补充说明

1. 安全建议：建议使用环境变量配置用户名密码，避免将密码暴漏在进程列表中
2. 性能优化：单个命令只监控单个目标主机, 使用 categraf 的调度机制保证执行性能
3. 文件尺寸：代码逻辑较为简单，二进制包比较大主要是 Bunjs 包本身的关系，请自行评估
4. 其他要点：默认执行连接超时为 5s，要避免 categraf 的采集间隔不要低于 5s，建议在 30s 以上
