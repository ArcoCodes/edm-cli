# Youmeng (Renoise) 数据库说明与访问参考

## 连接方式

通过 EdgeSpark SQL API 远程查询友盟（Youmeng/Renoise）项目的 D1 数据库。

- **API 端点**: `POST https://api.edgespark.dev/api/v1/project/database/sql/execute`
- **API Key**: 在 `/Users/l13/Desktop/renoise-edm/edm/.env` 的 `EDGESPARK_API_KEY` 字段
- **Youmeng Project ID**: `1fb1f523-4ee1-4af5-9f1b-aefc12c84ab4`（来自 `/Users/l13/Desktop/renoise-edm/youmeng/packages/worker/edgespark.toml`）
- **必须传 `environment: "production"`**，否则返回 400

### curl 模板

```bash
curl -s -X POST 'https://api.edgespark.dev/api/v1/project/database/sql/execute' \
  -H "Authorization: Bearer $EDGESPARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"project_id":"1fb1f523-4ee1-4af5-9f1b-aefc12c84ab4","environment":"production","sql":"YOUR SQL HERE"}'
```

### 响应结构

```json
{
  "code": 0,
  "data": {
    "success": true,
    "results": [{ "rows": [...], "meta": {...} }]
  }
}
```

数据在 `data.results[0].rows`。EDM worker 的 `youmeng-client.ts` 也通过同一个 API 查youmeng数据库。

---

## 完整表结构

### 用户与认证（EdgeSpark 平台表）

**es_system__auth_user** — 用户主表（~37,800 条）
| 列 | 说明 |
|---|---|
| id | string PK，随机 ID |
| name | 用户名 |
| email | 邮箱（唯一） |
| email_verified | 0/1 |
| image | 头像 URL |
| banned | 0/1 |
| ban_reason | 封禁原因 |
| ban_expires | 封禁到期 |
| is_anonymous | 0/1 |
| last_login_at | 最后登录 |
| created_at | 注册时间（unix ms） |
| updated_at | 更新时间（unix ms） |

**es_system__auth_account** — 登录方式（credential/oauth）
| 列 | 说明 |
|---|---|
| id | string PK |
| user_id | → auth_user.id |
| provider_id | credential / google 等 |
| account_id | 账号标识（邮箱或 OAuth ID） |
| password | bcrypt hash（credential 方式） |
| access_token, refresh_token | OAuth token |

**es_system__auth_session** — 会话
| 列 | 说明 |
|---|---|
| id | string PK |
| userId | → auth_user.id |
| expiresAt | 过期时间 |

### 订阅与付费

**subscriptions** — 订阅记录（~2,000 条）
| 列 | 说明 |
|---|---|
| id | int PK |
| user_id | → auth_user.id |
| plan_key | lite / basic / standard / advance |
| status | active / canceled / past_due / pending |
| provider | stripe / waffo |
| monthly_credits | 月度 credits 额度 |
| current_period_start | 当前周期开始 |
| current_period_end | 当前周期结束 |
| cancel_at_period_end | 0/1 是否到期取消 |
| canceled_at | 取消时间 |
| stripe_customer_id | Stripe 客户 ID |
| stripe_subscription_id | Stripe 订阅 ID |
| pending_plan_key | 待降级 plan |
| pending_upgrade_plan_key | 待升级 plan |
| created_at, updated_at | 时间戳 |

**payments** — 付款记录（~4,050 条）
| 列 | 说明 |
|---|---|
| id | int PK |
| user_id | → auth_user.id |
| amount | 金额（cents） |
| currency | usd |
| credits | 购买的 credits |
| status | succeeded / pending / failed |
| provider | stripe |
| price_id | Stripe price ID |
| stripe_checkout_session_id | Stripe session |
| stripe_payment_intent_id | Stripe payment intent |
| order_id | 内部订单号 |
| created_at, updated_at | 时间戳 |

### Credits

**user_credits** — 用户当前余额
| 列 | 说明 |
|---|---|
| user_id | string PK → auth_user.id |
| balance | 当前余额（浮点数） |
| nonce | 幂等 key |
| updated_at | 最后更新 |

**credit_transactions** — credits 流水
| 列 | 说明 |
|---|---|
| id | int PK |
| user_id | → auth_user.id |
| type | topup（充值）/ consume（消费）等 |
| amount | 变动数额 |
| balance_after | 变动后余额 |
| task_id | 关联任务 ID（消费时） |
| idempotency_key | 幂等 key |
| note | 备注 |
| created_at | 时间戳 |

**credit_pricing_v2** — credits 定价
| 列 | 说明 |
|---|---|
| id | int PK |
| model | 模型名（seedance-2.0 等） |
| variant | 变体（video_ref 等） |
| credit | 单位消耗 credits |
| unit | 计量单位（second） |
| user_id | 用户专属价格（空=通用） |

### 任务与生成

**tasks** — 生成任务（~95,800 条）
| 列 | 说明 |
|---|---|
| id | int PK |
| user_id | → auth_user.id（可为 null，早期数据） |
| type | video / image |
| model | seedance-2.0 等 |
| provider | jimeng 等 |
| prompt | 用户 prompt |
| input | JSON，包含参数（duration, ratio, materials） |
| status | pending / processing / completed / cancelled / failed |
| error | 错误信息 |
| result | JSON 结果 |
| tags | JSON 数组 |
| estimated_credit | 预估消耗 |
| actual_cost | 实际消耗 |
| provider_task_id | 供应商任务 ID |
| account_id | 使用的供应商账号 |
| assigned_at, started_at, completed_at | 各阶段时间 |
| video_storage_path | 视频存储路径 |
| video_archived_at | 归档时间 |
| created_at | 创建时间（ISO string） |

**materials** — 素材（~79,800 条）
| 列 | 说明 |
|---|---|
| id | int PK |
| user_id | 上传者 |
| name | 文件名 |
| type | image / video |
| mime_type | MIME 类型 |
| size | 字节大小 |
| storage_path | 存储路径 |
| md5 | 文件 hash |
| scope | user / system |
| metadata | JSON |
| deleted_at | 软删除 |
| created_at | 时间戳 |

### Face Pass 资产

**user_assets** — Face Pass 资产（~16,000 条）
| 列 | 说明 |
|---|---|
| id | int PK |
| user_id | → auth_user.id |
| name | 资产名 |
| material_id | → materials.id |
| group_id | → user_asset_groups.id |
| ark_asset_id | 方舟平台 asset ID |
| scope | user / showcase |
| status | pending / processing / active / failed |
| enabled | 0/1 |
| error_message | 错误信息 |
| created_at, updated_at | 时间戳 |

**user_asset_groups** — 资产分组
| 列 | 说明 |
|---|---|
| id | int PK |
| user_id | → auth_user.id |
| name | 分组名 |
| ark_group_id | 方舟平台 group ID |
| created_at | 时间戳 |

### 角色与模板

**characters** — 预设角色
| 列 | 说明 |
|---|---|
| id | int PK |
| code | 角色代码（F01 等） |
| name | 角色名 |
| gender, category | 性别/分类 |
| image_uri | S3 路径 |
| asset_id | 方舟 asset ID |
| usage_group | reserved / public |
| enabled | 0/1 |

**character_grants** — 角色授权
| 列 | 说明 |
|---|---|
| id | int PK |
| user_id | → auth_user.id |
| grant_type | all / specific |
| grant_value | 具体角色（grant_type=specific 时） |

**templates** — 创作模板
| 列 | 说明 |
|---|---|
| id | int PK |
| title | 标题 |
| prompt | 默认 prompt |
| config | JSON（model, duration, ratio） |
| cover_url, video_url | 封面和视频 URL |
| unlock_credit | 解锁所需 credits |
| sort_key | 排序 |
| enabled | 0/1 |
| author_user_id | 创作者 |

**template_unlocks** — 模板解锁记录
| 列 | 说明 |
|---|---|
| id, user_id, template_id | 关联 |
| credit_spent | 花费 credits |
| created_at | 时间戳 |

### 其他业务表

**creators** — 创作者/KOL
| 列 | 说明 |
|---|---|
| user_id | → auth_user.id |
| bio | 简介 |
| enabled | 0/1 |

**canvas_projects** — 画布项目（~2,200 条）
| 列 | 说明 |
|---|---|
| id | UUID |
| user_id | → auth_user.id |
| name | 项目名 |
| revision | 版本号 |
| current_snapshot_id | 当前快照 |
| is_locked | 0/1 |

**api_keys** — 用户 API Key
| 列 | 说明 |
|---|---|
| id | int PK |
| user_id | → auth_user.id |
| key | fk_前缀的 key |
| name | 名称 |
| revoked_at | 吊销时间 |

**accounts** — 供应商账号池（视频生成用）
| 列 | 说明 |
|---|---|
| id | int PK |
| uid | 平台 UID |
| token | 登录 token |
| status | online / offline |
| platform_running | 在跑任务数 |

**user_config** — 用户级配置
| 列 | 说明 |
|---|---|
| id | int PK |
| userId | → auth_user.id |
| key | 配置键（如 max_assets_per_user, ark_max_concurrent_per_user） |
| value | 配置值 |

**llm_daily_usage** — LLM 调用日统计
| 列 | 说明 |
|---|---|
| user_id, date, model | 维度 |
| requests | 请求数 |
| prompt_tokens, completion_tokens | token 用量 |
| cache_read_tokens, cache_write_tokens | 缓存 token |
| cost_credit | credits 消耗 |

**redemption_codes** — 兑换码
| 列 | 说明 |
|---|---|
| id | int PK |
| code | 兑换码字符串 |
| reward_type | credits |
| reward_payload | JSON（如 {"credits":1000}） |
| max_redemptions | 最大兑换次数 |
| redeemed_count | 已兑换次数 |
| source_key | 来源标识 |

**redemption_records** — 兑换记录
| 列 | 说明 |
|---|---|
| id | int PK |
| code_id | → redemption_codes.id |
| user_id | → auth_user.id |

---

## 套餐映射

产品名与数据库 plan_key 不同：

| 产品名 | DB plan_key | 面向用户名称 |
|--------|------------|------------|
| Starter | basic | EDM 前端显示 "Starter" |
| Standard | standard | EDM 前端显示 "Standard" |
| Advanced | advance | EDM 前端显示 "Advanced" |
| (旧套餐) | lite | 不在 EDM 选项中，忽略 |

Face Pass 限额（定义在友盟 `packages/worker/src/services/assets.ts` 的 `FACE_PASS_PLAN_LIMITS`）：

| plan_key | 限额 |
|----------|------|
| none / lite | 50 |
| basic | 80 |
| standard | 160 |
| advance | 9999 |

---

## 常用查询

**30天活跃用户**（提交过生成任务）:
```sql
SELECT DISTINCT u.id, u.name, u.email
FROM es_system__auth_user u
INNER JOIN tasks t ON t.user_id = u.id
WHERE t.created_at >= datetime('now', '-30 days') AND u.banned = 0
```

**某套餐的活跃用户**:
```sql
SELECT u.id, u.name, u.email
FROM es_system__auth_user u
INNER JOIN subscriptions s ON s.user_id = u.id
WHERE s.plan_key = 'basic' AND s.status = 'active' AND u.banned = 0
```

**查单个用户全貌**（替换 TARGET_EMAIL）:
```sql
SELECT u.id, u.name, u.email, u.banned,
  COALESCE(uc.balance, 0) AS credit_balance,
  s.plan_key, s.status AS sub_status, s.current_period_end,
  (SELECT COUNT(*) FROM user_assets a WHERE a.user_id = u.id
    AND a.scope = 'user' AND a.status != 'failed'
    AND (a.enabled = 1 OR a.enabled IS NULL)) AS active_assets,
  (SELECT COUNT(*) FROM payments p WHERE p.user_id = u.id
    AND p.status = 'succeeded') AS payment_count,
  (SELECT COUNT(*) FROM tasks t WHERE t.user_id = u.id) AS task_count
FROM es_system__auth_user u
LEFT JOIN user_credits uc ON uc.user_id = u.id
LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
WHERE u.email = 'TARGET_EMAIL'
```

**各套餐用户数分布**:
```sql
SELECT plan_key, status, COUNT(*) as cnt
FROM subscriptions GROUP BY plan_key, status ORDER BY plan_key, status
```

**Face Pass 达到限额的用户**:
```sql
SELECT u.email, u.name, COUNT(a.id) AS asset_count,
  COALESCE(s.plan_key, 'none') AS plan_key
FROM es_system__auth_user u
INNER JOIN user_assets a ON a.user_id = u.id
  AND a.scope = 'user' AND a.status != 'failed'
  AND (a.enabled = 1 OR a.enabled IS NULL)
LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
WHERE u.banned = 0
GROUP BY u.id
HAVING asset_count >= CASE COALESCE(s.plan_key, 'none')
  WHEN 'advance' THEN 9999 WHEN 'standard' THEN 160
  WHEN 'basic' THEN 80 ELSE 50 END
ORDER BY asset_count DESC
```

---

## 可查询的用户属性（筛选维度）

以下是数据库能支持的用户筛选维度，**不含**地理位置、语言、时区、设备、浏览器等信息：

| 维度 | 来源表 | 可用字段/指标 |
|------|--------|--------------|
| 注册信息 | es_system__auth_user | name, email, created_at, last_login_at, banned |
| 登录方式 | es_system__auth_account | provider_id (credential / google 等) |
| 订阅等级 | subscriptions | plan_key (lite/basic/standard/advance), status (active/canceled/past_due) |
| 付费金额 | payments | amount, currency, credits, status, 可聚合总消费 |
| Credits 余额 | user_credits | balance |
| Credits 流水 | credit_transactions | type (topup/consume), amount, 可聚合消费总量 |
| 生成任务 | tasks | type (video/image), model, status, created_at, 可聚合任务数 |
| 素材上传 | materials | type (image/video), size, 可聚合上传数 |
| Face Pass | user_assets | 资产数量, status, enabled |
| Canvas 项目 | canvas_projects | 项目数 |
| 模板解锁 | template_unlocks | 解锁的模板, credit_spent |
| LLM 调用 | llm_daily_usage | model, requests, token 用量, cost_credit |
| API Key | api_keys | 是否创建过 API Key |
| 兑换码 | redemption_records + redemption_codes | 兑换记录, source_key |

### 通过 payments.metadata 可间接查询的属性（仅限付过款的用户）

`payments.metadata` 是 JSON 字段，前端 checkout 时写入了丰富的归因和环境信息，可用 `json_extract()` 提取：

| 字段 | 说明 | 示例值 |
|------|------|--------|
| `attr_locale` | 浏览器语言/地区 | `ja`, `en-US`, `zh-CN`, `ko-KR` |
| `attr_timezone` | 浏览器时区 | `Asia/Tokyo`, `America/New_York` |
| `attr_device_type` | 设备类型 | `desktop`, `mobile` |
| `attr_is_mobile_ua` | 是否手机 UA | `true`, `false` |
| `attr_utm_source` | UTM 来源 | `ig`, `google` |
| `attr_utm_medium` | UTM 媒介 | `social`, `meta`, `google` |
| `attr_utm_campaign` | UTM 活动 | campaign ID |
| `attr_utm_content` | UTM 内容 | `link_in_bio` |
| `attr_landing_path` | 着陆页路径 | `/`, `/onboarding` |
| `attr_path` | Checkout 页面路径 | `/videos?modal=subscribe` |
| `attr_referrer` | 来源页 URL | `https://www.google.com/` |
| `attr_channel` | 渠道 | - |
| `attr_fbclid` | Facebook Click ID | - |
| `attr_gclid` | Google Click ID | - |

示例：查日本付费用户

```sql
SELECT DISTINCT u.email, u.name
FROM es_system__auth_user u
INNER JOIN payments p ON p.user_id = u.id
WHERE p.status = 'succeeded'
  AND (json_extract(p.metadata, '$.attr_locale') LIKE 'ja%'
       OR json_extract(p.metadata, '$.attr_timezone') = 'Asia/Tokyo')
  AND u.banned = 0
```

**限制**：这些字段只在付费时采集，未付费的用户没有此信息。

### 不可查询的属性（未付费用户）

对于未付费用户，数据库中**没有**以下字段：

- 国家/地区、IP 地址
- 语言/Locale
- 时区
- 设备类型、操作系统、浏览器
- 推荐来源/UTM 参数

---

## 注意事项

- D1 不支持 PRAGMA，查表结构用 `SELECT * FROM table LIMIT 1`
- D1 不支持 BEGIN/COMMIT/ROLLBACK/ATTACH/VACUUM
- `edgespark db sql` CLI 只能查当前项目（EDM），查友盟必须走 API
- `created_at` 格式不统一：auth_user 用 unix ms，tasks 用 ISO string，subscriptions 也是 ISO string
- 查所有表名：`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
