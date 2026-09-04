# 樱花市集 · 二次元自助发卡系统

基于 **Cloudflare Pages + Workers + D1 + KV** 的加密货币自助发卡平台。支持 **USDT (TRC-20) 收款**，支付到账后**自动发货**，并可**自动归集**到主钱包。界面为毛玻璃 (glassmorphism) 二次元风格，PC / 手机自适应。

## 功能

**前台**
- 商品展示、下单、USDT (TRC-20) 转账、链上确认后自动发货、查单
- 购买后凭私密 `view_token` 查看卡密；邮箱可选，用于接收发货通知（支持 HTML 邮件）

**后台管理**（`/admin/login`）
- 商品 CRUD、批量导入卡密、上架/下架、库存/销量
- 订单列表（待支付/已付待发/已发货/已关闭）、手动补发、**查看订单卡密**、**模拟到账**（测试用）
- 经营概览：商品数、可售库存、已发货收入、待归集金额
- 支付流水对账：交易哈希、金额、确认数、状态
- **退款管理**：新建退款、查看列表、标记状态（待处理/进行中/已退款/失败）
- **资金归集**：自动/手动归集任务、交易哈希查看、干跑校验、标记完成
- **操作日志**：记录登录、商品/卡密/订单/退款/归集等后台操作
- **系统自检**：一键检查环境变量、数据库、USDT 合约地址、HD 地址派生、链上 RPC

**自动归集（USDT TRC-20 → 主钱包）**
- 发货时自动创建归集任务，记录源地址、金额、目标地址、HD 派生索引
- 后台可“干跑校验”（只构建+签名，不广播）验证交易；验证通过后开启 `AUTO_SWEEP_ENABLED=true`
- 由独立 cron Worker 定时执行；私钥仅在内存按需派生，**不落库、不外发**，签名在本地完成

**内置收款钱包（无需自备凭证）**
- 后台「收款钱包」一键生成专属钱包：自动派生每单收款子地址 + 系统主钱包，自动归集到主钱包
- 助记词由系统保存，可在后台查看/导出；可重新生成（强警告）或改用外部 `TRON_MASTER_ADDRESS`
- 内置小白引导：备份助记词 / 预存 TRX / USDT-TRC20 说明，无需 USDT 知识也能上手

## 环境要求

- Node.js >= 18
- 一个 Cloudflare 账号（Pages + D1 + KV + Workers，免费额度内）

## 本地开发

```bash
npm install
# 初始化本地 D1（schema.sql 已包含全部表，无需额外迁移）
npx wrangler d1 execute faka-db --local --file=schema.sql
# (可选) 灌入测试数据
npx wrangler d1 execute faka-db --local --file=seed.sql

# 构建 + 本地预览 (Pages 模式)
npm run build
npx wrangler pages dev dist --local --port 8790
```

访问 http://127.0.0.1:8790 即为商店，`/admin` 为后台（本地密码见 `.dev.vars` 的 `ADMIN_PASSWORD`）。

## 部署到 Cloudflare

### 1. 创建资源

在 Cloudflare Dashboard 创建：
- **Pages 项目**（绑定本仓库，构建命令 `npm run build`，输出目录 `dist`）
- **D1 数据库** `faka-db`
- **KV 命名空间**（用于后台登录会话）
- （可选）**Workers 定时任务**，用 `wrangler.cron.toml` 配置，每分钟轮询订单/归集

### 2. 首次建表

```bash
# 全新部署：schema.sql 为完整基线，直接执行即可
npx wrangler d1 execute faka-db --remote --file=schema.sql
```

> ⚠️ **已在运行的老库**：请按迁移先后顺序执行 `migration-v2.sql` → `v3` → `v4` → `v5` → `v6` → `v7` → `v8` → `v9` → `v10` → `v11`（v7 归集字段、v8 内置钱包、v9 审计表、v10 钱包加密列、v11 归集重试列 + order_cards）。

### 3. 配置绑定

在 `wrangler.toml` 中填入真实 ID（部署前必须修改）：

```
[[d1_databases]] binding = "DB" database_name = "faka-db" database_id = "<你的D1 ID>"
[[kv_namespaces]] binding = "KV" id = "<你的KV ID>"
```

### 4. 配置环境变量

普通（非敏感）变量在 `wrangler.toml` 的 `[vars]` 或用 Dashboard 的 `Settings -> Variables` 配置；**密钥类务必用 Secret**，切勿写入代码库。

| 变量 | 类型 | 说明 |
|------|------|------|
| `SITE_NAME` | var | 站点名，如 `樱花市集` |
| `SITE_WELCOME` | var | 首页欢迎语 |
| `ADMIN_PASSWORD` | **secret** | 后台登录密码（可用默认 `faka8888` 登录后在后改，务必尽快修改） |
| `WALLET_ENCRYPTION_KEY` | **secret（必须）** | 加密助记词的 AES-256-GCM 密钥（随机强值；帮助记词安全存库） |
| `TRON_MNEMONIC` | **secret（可选）** | 外部助记词（仅当你想自管钱包时填；**推荐用后台「收款钱包」一键生成**，系统加密保存） |
| `TRON_MASTER_ADDRESS` | **secret（可选）** | 外部主钱包地址（仅当你想把资金归集到自己冷钱包时填；否则用系统内置主钱包） |
| `TRON_RPC_URL` | var | TRON 节点，默认 `https://api.trongrid.io` |
| `TRON_CONFIRMATIONS` | var | 到账确认数阈值，默认 19 |
| `CRON_SECRET` | **secret** | 定时任务/手动触发密钥 |
| `AUTO_SWEEP_ENABLED` | var | 是否启用自动归集，默认 `false` |
| `SWEEP_FEE_LIMIT` | var | 单笔归集能量费上限（sun），默认 `100000000` |
| `SWEEP_MIN_AMOUNT` | var | 最小归集金额（USDT 最小单位），默认 `10000`（=0.01 USDT）|
| `RESEND_API_KEY` | **secret** | Resend 邮件 API Key（可选） |
| `MAIL_FROM` | **secret** | 发件人（如 `樱花市集 <no-reply@yourdomain.com>`）|

```bash
npx wrangler pages secret put ADMIN_PASSWORD
npx wrangler pages secret put TRON_MNEMONIC
npx wrangler pages secret put TRON_MASTER_ADDRESS
npx wrangler pages secret put CRON_SECRET
npx wrangler pages secret put RESEND_API_KEY
npx wrangler pages secret put MAIL_FROM
```

### 5. 构建部署

```bash
npm run build
npx wrangler pages deploy dist --project-name <你的项目名>
```

## 上线前验收 / 测试指引

上线处理真实资金前，建议：**先跑一遍不涉及真实资金的全流程，再决定是否开启自动归集**。

### 自动化单元测试（本地）
```bash
npm test     # vitest：地址校验、钱包加解密、密码哈希、订单状态机、数量/价格校验
```
涵盖：TRON 地址校验、AES-GCM 加解密、密码哈希、订单状态机合法/非法迁移、数量与价格精度校验。

### 零、本地自动冒烟测试（不涉及真实资金）

本地跑一遍"下单 → 模拟到账 → 自动发货 → 建归集任务 → 干跑"链路：

```bash
npm run dev                       # 启动本地 dev server（默认 http://localhost:4321）
node scripts/smoke.mjs            # 运行自动冒烟测试
```

脚本依赖 `.dev.vars` 中的 `ADMIN_PASSWORD`（默认 `Sakura2024!`）。可用 `FAKA_BASE` 指定地址。全部输出 `✅` 即链路正常；「干跑校验」在未配置 `TRON_MASTER_ADDRESS` 时会提示，属预期。

### 一、系统自检（无需真实资金）
登录后台 → 「系统自检」→ 一键运行。将校验环境变量、数据库、USDT 合约地址（应为 `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`）、HD 地址派生、链上 RPC 是否可达。全部 ✅ 通过后再继续。

### 二、模拟到账测试（无需真实资金）
1. 后台 → 商品管理，新增一个商品并导入若干卡密（`seed.sql` 已有示例数据）。
2. 前台下单生成订单（记录订单号）。
3. 后台 → 订单管理，对该「待支付」订单点「模拟到账」。系统会用占位交易哈希把它当作已到账并**自动发货**，同时创建资金归集任务。
4. 到「资金归集」刷新，确认出现 `pending` 任务；点「干跑校验」验证交易构造（会返回 `raw_data_hex / txID / signature`，**不广播**）。至此已完成“下单 → 发货 → 建归集任务 → 干跑”链路。

### 三、真实资金测试（需要你提供地址）
仅当上面两步通过、且你提供带少量资金的地址时才执行：
1. 后台「系统自检」确认 RPC 与合约地址全绿。
2. **收款钱包 → 一键生成**并备份助记词；记下系统主钱包地址（归集目标）。
3. 给「收款子地址 + 主钱包」预存足够 TRX（约 0.1–1 TRX 即可，用于能量费）。
4. 前台下单，得到该单**独立收款地址**。
5. 向你自己的一个有钱地址，向该**订单收款地址**转账 **0.01 USDT (TRC-20)**。
6. 后台「资金归集 → 干跑校验」应先能构建+签名成功；确认无误后设 `AUTO_SWEEP_ENABLED=true` 再点「执行归集」。
7. 观察：订单状态 pending → payment_detected → paid → shipped；归集任务 pending → broadcasting → completed 且主钱包收到 USDT。
8. 全部成功后再开设正式收款；否则用「操作日志 / order_events」排查。

> 系统内置「模拟到账」只生成占位哈希，不涉及真实扣款，仅用于链路测试。

## 自动归集使用指引

1. 发货后会为每张子地址订单创建 `pending` 归集任务（记录源地址、金额、派生索引、目标地址）。
2. 后台「资金归集 → 干跑校验」：会读取链上 USDT 余额、构建交易、本地签名，并返回 `raw_data_hex / txID / signature`，**不会广播**。这一步用于确认配置与链路都正确。
3. 确认无误后，把 `AUTO_SWEEP_ENABLED` 设为 `true` 并部署。cron Worker 每分钟会处理 `pending` 任务，真实广播到 `TRON_MASTER_ADDRESS`。
4. 也可在后台对单个任务点「执行归集」手动触发。

> ⚠️ **关键前提**：每个收款子地址需要**预存足够 TRX** 作为能量费（单笔 USDT 转账通常需约 40–65 TRX，建议预存 100 TRX，或给子地址配置代理/冻结能量），否则广播会被拒（`INSUFFICIENT_BALANCE`）。主钱包建议用独立冷钱包。
> ⚠️ **安全设计**：私钥只在签名一瞬间在内存派生，绝不落库、绝不发给第三方；`TRON_MNEMONIC` 泄露等于丢币，务必离线保存，且不要把 `TRON_MASTER_ADDRESS` 与助记词放同一处。

## 邮件通知（可选）

设置 `RESEND_API_KEY` 与 `MAIL_FROM` 后，买家在购买页填写的邮箱会在发货时收到 HTML 通知。未配置时订单仍正常发货，仅不发信；系统会定期重试未发出的邮件。

## 收款原理（USDT TRC-20）

1. 后台「收款钱包」一键生成系统专属钱包（也可用外部 `TRON_MNEMONIC`/`TRON_MASTER_ADDRESS` 覆盖）
2. 每个订单从该助记词派生一个唯一子地址（BIP-44 coin type 195）
3. 买家向该地址转账 USDT (TRC-20)
4. 系统轮询 TRON 节点，用交易区块号与当前链高度计算确认数
5. 达到确认数阈值后自动占用卡密并发货，并创建归集任务（自动或手动归集到主钱包）

> ⚠️ **重要**：收款地址需预存足够的 TRX 作为手续费/能量费，否则 USDT 无法转出。

## 目录结构

```
src/
├── pages/
│   ├── index.astro           # 商城首页
│   ├── product/[id].astro    # 商品详情+下单
│   ├── admin/                # 后台管理
│   └── api/                  # 后端 API (含 admin/*)
├── components/              # BuyPanel 购买交互 / ProductCard 卡片
├── layouts/                 # 毛玻璃导航 + 页脚
├── lib/
│   ├── db.ts                # 数据库操作 + 价格精度换算
│   ├── tron.ts              # HD钱包派生 + 链上确认检测 + base58/hex 工具
│   ├── tron-sweep.ts        # 真实 USDT 自动归集引擎 (构建/签名/广播)
│   ├── orders.ts            # 订单/确认/自动发货/补发
│   ├── mail.ts              # Resend 发货邮件
│   ├── auth.ts / adminAuth.ts # 后台鉴权 (KV 会话)
│   ├── api.ts / site.ts     # API 工具 / 站点配置
│   └── wallet.ts            # 系统内置收款钱包 (生成/保存/概览)
├── cron-worker.ts           # 独立 Worker：定时轮询订单 + 归集 + 重试邮件
└── types/index.ts           # 类型定义 + StoreEnv
schema.sql                    # D1 完整表结构 (全新部署基线)
migration-v2..v8.sql          # 老库增量迁移 (v7 归集字段, v8 内置收款钱包)
```

## 安全与运维提示

- 生产环境务必修改 `ADMIN_PASSWORD`，并通过 Secret 设置 `TRON_MNEMONIC` / `TRON_MASTER_ADDRESS`
- **助记词泄露会导致资产被盗**，务必离线保管，不要提交到 git / 聊天 / 公开仓库
- 定期检查支付流水与归集任务，确认资金已安全进入主钱包
- **如果曾把 Cloudflare API Token / Secret 发到聊天或公开渠道，请立即去 Dashboard 删除并轮换该 Token**，同时提示检查是否有未授权的 API 调用
- 建议先在本地（`.dev.vars` + 本地 D1 + 本地预览）把下单→支付→发货→归集流程跑通，再上生产
