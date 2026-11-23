# 喵导供应商工具流录制验收

本步骤验证真实供应商的工具流是否能被当前 SDK 解码，不调用供应商、不写平台配置，也不自行开放真实模型。

## 录制材料

为每个待开放的**实际模型 ID**单独准备两段已审查、脱敏的供应商 SSE 正文：

1. 初次请求至少返回一段文本，并发出一个符合喵导工具 schema 的 `build_graph` 调用。
2. 把该调用的合成结果续入同一对话，供应商发出一个符合 schema 的 `find_nodes` 调用。

两段都应保留原协议的模型标识及正数输入、输出 token 用量。使用合成业务内容与假素材；删除 HTTP 请求/响应头、密钥、Cookie、真实用户或作品标识及素材地址。DeepSeek 的录制须按喵导实际配置使用非思考模式。

把两段 **SSE 正文**作为 JSON 字符串放进以下限额为 512 KiB 的文件。示例只有形状，不是供应商录制，也不是可开放的模型登记：

```json
{
  "source": "provider-capture",
  "providerId": "deepseek",
  "modelId": "<供应商请求使用的实际模型 ID>",
  "first": {
    "reportedModelId": "<第一段 SSE 报告的模型 ID>",
    "stream": "<第一段原协议 SSE 正文>"
  },
  "followUp": {
    "reportedModelId": "<第二段 SSE 报告的模型 ID>",
    "stream": "<续发 SSE 正文>"
  }
}
```

## 离线复验

在 LanmiaoTV 根目录执行：

```sh
NORI_CANVAS_AGENT_RECORDING=/path/to/reviewed-capture.json BILLING_TEST_BOOTSTRAP=0 \
  ./node_modules/.bin/vitest run tests/unit/canvas-agent/model-stream-contract.test.ts \
  -t 'separately reviewed'
```

测试替换全部供应商请求，使用实际安装的 SDK 回放两段流，核对两次调用路径、请求与响应模型、工具调用和用量。回放通过只证明兼容性，不证明录制来源或计价正确。审查人须另行确认来源、模型版本、计价和工具流，再更新 `provider-registry.ts` 中对应的独立认证标记并走上线审批。
