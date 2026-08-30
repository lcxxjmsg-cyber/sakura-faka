# 樱花市集 · 二次元自助发卡系统

基于 **Cloudflare Pages + Workers + D1** 的加密货币自助发卡平台。支持 **USDT (TRC-20) 收款**，支付后自动发货。界面为毛玻璃(glassmorphism)二次元风格。

## 功能

- 商城前台：商品展示、下单、USDT (TRC-20) 转账、自动发卡
- 后台管理：商品 CRUD、批量导入卡密、订单查看、手动补发
- 收款机制：每订单独立子地址（HD 钱包派生），链上确认后自动发货
- 安全：卡密仅凭私密 `view_token` 可查看，订单查询接口裁剪敏感字段
- 二次元主题：毛玻璃面板 + 樱花渐变背景，PC / 手机自适应

## 环境要求

- Node.js >= 18
- 一个 Cloudflare 账号（Pages + D1 + KV + Workers 全免费额度内）

## 本地开发

```bash
npm install
# 初始化本地 D1
npx wrangler d1 execute faka-db --local --file=schema.sql
# (可选) 灌入测试数据
npx wrangler d1 execute faka-db --local --file=seed.sql

# 构建
npm run build
# 本地预览 (Pages 模式)
npx wrangler pages dev dist --local --port 8790
```

访问 http://127.0.0.1:8790 即为商店，`/admin` 为后台。

## 部署到 Cloudflare

### 1. 创建资源

在 Cloudflare Dashboard 创建:
- **Pages 项目**（绑定本仓库，构建命令 `npm run build`，输出目录 `dist`）
- **D1 数据库** `faka-db`
- **KV 命名空间**（用于后台登录会话）

### 2. 首次建表

```bash
npx wrangler d1 execute faka-db --remote --file=schema.sql
```

### 3. 配置环境变量（关键安全项）

#### 通过 Cloudflare Dashboard（推荐，密钥类走 Secrets）
在 Pages 项目的 `Settings -> Environment variables` 添加：

| 变量 | 说明 |
|------|------|
| `SITE_NAME` | 站点名，如 `樱花市集` |
| `SITE_WELCOME` | 首页欢迎语 |
| `ADMIN_PASSWORD` | 后台登录密码（**务必修改**）|
| `TRON_MNEMONIC` | HD 钱包助记词（**保留为空，必须在 Secrets 里设置，切勿写入代码库**）|
| `TRON_RPC_URL` | TRON 节点，默认 `https://api.trongrid.io` |
| `TRON_CONFIRMATIONS` | 确认数阈值，默认 19 |
| `CRON_SECRET` | 自动发货定时任务密钥 |

> ⚠️ **安全提示**：`TRON_MNEMONIC` 是钱包助记词，泄露会被盗走全部资金。部署时仅以 Secret 形式设置，**绝不可提交到 git**。`wrangler.toml` 中该项请保持为空。

#### 配置绑定
在 `wrangler.toml` 填入真实 ID（部署前必须改）：
```
[[d1_databases]] binding = "DB" database_name = "faka-db" database_id = "<你的D1 ID>"
[[kv_namespaces]] binding = "KV" id = "<你的KV ID>"
```

#### 或使用 `wrangler secret put`
```bash
npx wrangler pages secret put TRON_MNEMONIC
npx wrangler pages secret put ADMIN_PASSWORD
npx wrangler pages secret put CRON_SECRET
```

### 4. 构建部署

```bash
npm run build
npx wrangler pages deploy dist --project-name <你的项目名>
```

## 收款原理（USDT TRC-20）

1. 每个订单从 HD 助记词派生一个唯一子地址（BIP-44 coin type 195）
2. 买家向该地址转账 USDT (TRC-20)
3. 系统轮询 TRON 节点，用交易区块号与当前链高度计算确认数
4. 达到确认数阈值后自动占用卡密并发货

> ⚠️ **重要**：收款地址需预存少量 TRX 作为手续费，否则 USDT 无法转出。

## 环境变量备份（wrangler.toml）

以下为本地开发用的默认值。**部署前请修改 `ADMIN_PASSWORD`，并通过 Secret 设置 `TRON_MNEMONIC`。** 保持 `wrangler.toml` 中的 `TRON_MNEMONIC` 为空即可。

## 目录结构

```
src/
├── pages/            # 页面 + API 端点
│   ├── index.astro       # 商城首页
│   ├── product/[id].astro# 商品详情+下单
│   ├── admin/            # 后台管理
│   └── api/              # 后端 API
├── components/       # UI 组件（BuyPanel 购买交互 / ProductCard 卡片）
├── layouts/          # 布局（毛玻璃导航 + 页脚）
├── lib/              # 核心逻辑
│   ├── db.ts         # 数据库操作 + 价格精度换算
│   ├── tron.ts       # HD钱包派生 + 链上确认检测
│   ├── orders.ts     # 订单/确认/自动发货
│   └── auth.ts       # 后台鉴权(KV会话)
└── types/            # 类型定义
schema.sql            # D1 表结构
```

## 注意事项

- 生产环境务必修改 `ADMIN_PASSWORD` 和通过 Secret 设置 `TRON_MNEMONIC`
- 助记词泄露会导致资产被盗，务必离线保管
- 建议先在本地用测试环境跑通，再上生产
