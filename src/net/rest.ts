// Web-server REST 客户端（公会读接口等）。
//
// 鉴权约定（2026-09-25 定）：token 放 **`satoken` 请求头** —— 服务端 Sa-Token 的
// `token-name` 就是它（`apps/web-server/bootstrap.yml`），而 CORS 没开
// `allowCredentials` ⇒ cookie 方案走不通（`WebMvcConfig` 实测）。token 就是
// `/api/game/login` 返回的 `data.token`（与 WS `auth.token` 同一把钥匙）。
//
// 失败语义：`Result = {code, msg, data}`，`code === 200` 才是成功；失败时 `msg` 是
// **i18n key**（服务端只发文案 key 的全仓约定），调用方 `tOr` 翻译。
// 这里**不弹任何提示、不做任何兜底**：非 200 一律抛 `RestError`，由调用方决定怎么呈现
// —— AGENTS #12：显式地"没有"，不许换成默认值。

/** 与 main.ts 的 `apiBase` 同一套兜底逻辑（改一处时两处都要看）。 */
const API_BASE: string =
    (import.meta.env.VITE_API_BASE as string | undefined)
    || `http://${window.location.hostname}:8080/pt`;

/** REST 调用失败。`code` = 服务端业务码（200 之外的），`msgKey` = i18n key。 */
export class RestError extends Error {
    readonly code: number;
    readonly msgKey: string;

    constructor(code: number, msgKey: string) {
        super(`REST ${code}: ${msgKey}`);
        this.code = code;
        this.msgKey = msgKey;
    }
}

/** token 由登录流程写入（transport.ts 的模块级变量是唯一持有者，这里只读它）。 */
function satokenHeader(): Record<string, string> {
    // 延迟 import 会造成循环（transport 不依赖这里）——顶层 import 在下方。
    const t = getToken();
    // 没登录就没有 token：**不发匿名请求**（服务端会 401，但这里先挡住，
    // 面板在未登录状态下本来就不该出现）。
    return t ? { satoken: t } : {};
}

import { getToken } from './transport.js';

export async function postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...satokenHeader() },
        body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => null) as { code?: number; msg?: string; data?: T } | null;
    if (!data || typeof data.code !== 'number') {
        // 连 Result 包装都没有（网关错误页等）—— 显式失败，不猜
        throw new RestError(res.status, 'error.web.badResponse');
    }
    if (data.code !== 200) {
        throw new RestError(data.code, data.msg || 'error.web.noPermission');
    }
    return data.data as T;
}

// ====================================================================
// 公会读接口（/api/clan/*，服务端 ClanController）
// ====================================================================

export interface ClanMemberDto {
    charName: string;
    userId: string;
    charType: number;
    charLevel: number;
    /** '0'=普通成员（含会长），'2'=副会长。会长靠 detail.leader 判，这列分不出来。 */
    permission: string;
    joinDate: string;   // 'yyyy-MM-dd HH:mm:ss'（服务端 JVM 时区）
}

export interface ClanDetail {
    clanId: number | null;
    clanName: string;
    leader: string;
    subLeader: string;      // 空串 = 没有副会长
    note: string;
    memberCount: number;
    /** 图标编号（clandb.cl.miconcnt）→ 图像走 `/res/image/clanimage/...`（落点待定，暂不渲染位图） */
    iconId: number;
    regiDate: string;
    limitDate: string;
    clanMoney: number;
    cPoint: number | null;
    rank: number;           // 0 = 无排名（cPoint<=0 或不在榜）
    amLeader: boolean;
    amSubLeader: boolean;
    members: ClanMemberDto[];
}

export interface ClanRankRow {
    clanId: number;
    clanName: string;
    leader: string;
    memberCount: number;
    iconId: number;
    cPoint: number;
    clanMoney: number;
}

/** 公会详情（不在公会 → 抛 RestError(10501, 'error.web.notInClan')）。 */
export function fetchClanDetail(charName: string): Promise<ClanDetail> {
    return postJson<ClanDetail>('/api/clan/detail.json', { charName });
}

/** 排行榜（只含 cPoint>0 的公会；名次 = 数组下标+1，条目里没有名次字段）。 */
export function fetchClanRanking(): Promise<ClanRankRow[]> {
    return postJson<ClanRankRow[]>('/api/clan/ranking.json', {});
}

/** 公会名是否可用（200=可用；10502=已被占用；其余码原样抛）。 */
export async function checkClanName(clanName: string): Promise<boolean> {
    try {
        await postJson<null>('/api/clan/check-name.json', { clanName });
        return true;
    } catch (e) {
        if (e instanceof RestError && e.code === 10502) return false;   // CLAN_NAME_TAKEN
        throw e;
    }
}
