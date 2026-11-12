declare namespace Cloudflare {
  interface Env {
    DATABASE_URL?: string;
    TASK_WORKER_SECRET?: string;
    R2_ACCOUNT_ID?: string;
    R2_BUCKET_NAME?: string;
    R2_ACCESS_KEY_ID?: string;
    R2_SECRET_ACCESS_KEY?: string;
    BAIDU_OCR_API_KEY?: string;
    BAIDU_OCR_SECRET_KEY?: string;
    PAYMENT_ENABLED?: string;
    PAYMENT_TEST_ENABLED?: string;
    PAYMENT_GATEWAY_URL?: string;
    PAYMENT_SOURCE?: string;
    PAYMENT_SHARED_SECRET?: string;
    PAYMENT_RETURN_URL?: string;
    BUCKET?: R2Bucket;
    DEEPSEEK_API_KEY?: string;
    /** 会话 cookie 的 HMAC 签名密钥，至少 32 字符。缺失会让登录接口 500。 */
    SESSION_SECRET?: string;
    /**
     * 是否信任 `oai-authenticated-user-*` 请求头。
     * 只有本地开发（mock-auth）才设 "1"；生产环境绝不能设，
     * 否则任何人手工加一个请求头就能绕过登录。
     */
    TRUST_OAI_HEADERS?: string;
  }
}
