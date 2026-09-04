export type Product = {
  id: number;
  title: string;
  description: string;
  cover: string;
  price: string;       // USDT 最小单位整数 (1e6)
  stock: number;
  sold: number;
  category: string;
  delivery_type?: 'text' | 'json' | 'manual';
  status: number;
  sort: number;
  created_at: string;
  updated_at: string;
};

export type Card = {
  id: number;
  product_id: number;
  card: string;
  status: number;
  order_id: number | null;
  sold_at: string | null;
  created_at: string;
};

export type OrderStatus =
  | 'pending'
  | 'payment_detected'
  | 'paid'
  | 'fulfilling'
  | 'shipped'
  | 'closed'
  | 'refund_pending'
  | 'refunded'
  | 'manual_review';

export type Order = {
  id: string;
  product_id: number;
  product_title: string;
  qty: number;
  total_price: string; // USDT 最小单位
  address: string;     // 每订单唯一子地址
  address_index?: number;
  status: OrderStatus;
  tx_hash: string;
  tx_confirm: number;
  contact_email: string;
  view_token: string;
  card_ids: string;
  created_at: string;
  paid_at: string | null;
  expired_at: string | null;
  email_sent_at?: string | null;
};

export type StoreEnv = {
  DB: D1Database;
  KV: KVNamespace;
  SITE_NAME: string;
  SITE_WELCOME: string;
  ADMIN_PASSWORD: string;
  TRON_MNEMONIC: string;
  TRON_MASTER_ADDRESS: string;
  TRON_CONFIRMATIONS: string;
  POLL_INTERVAL: string;
  TRON_RPC_URL: string;
  TRON_PRO_API_KEY?: string;
  CRON_SECRET: string;
  WALLET_ENCRYPTION_KEY?: string;
  AUTO_SWEEP_ENABLED?: string;
  SWEEP_FEE_LIMIT?: string;
  SWEEP_MIN_AMOUNT?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
};
