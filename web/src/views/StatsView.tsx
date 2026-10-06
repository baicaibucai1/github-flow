import { useEffect, useState } from "react";
import { Badge, Button } from "@soda/ui";
import { call, log, ago, refillNow, refillStatus, type Counts, type MeReport, type RefillStatus } from "../lib/bridge";
import { useApp } from "../lib/store";
import { Box, BoxEmpty, BoxRow } from "../components/gh";

/** 统计页只报本机行为计数，不做任何"预测"。校准门槛 n>=20 直接写在界面上，
    免得看的人以为几百条数据就能改排序。 */
export function StatsView() {
  const { stats } = useApp();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [me, setMe] = useState<MeReport | null>(null);
  const [refill, setRefill] = useState<RefillStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRefill = () => refillStatus().then(setRefill).catch((e) => log("refill_status FAIL " + e));

  useEffect(() => {
    void call<Counts>("get_counts").then(setCounts).catch((e) => log("counts FAIL " + e));
    void call<MeReport>("me_report").then(setMe).catch((e) => log("me_report FAIL " + e));
    void loadRefill();
  }, []);

  if (!stats) {
    return (
      <div className="p-md">
        <Box>
          <BoxEmpty>读不到统计</BoxEmpty>
        </Box>
      </div>
    );
  }

  const ctr = (stats.opens / Math.max(stats.impressions, 1)) * 100;
  const ready = stats.impressions >= (me?.min_n ?? 20);

  return (
    <div className="flex flex-col gap-md p-md">
      <div>
        <h1 className="text-title">统计</h1>
        <p className="mt-2xs text-body text-muted-foreground">
          这些数字全部来自你在本机的行为，没有任何一条离开这台机器。
        </p>
      </div>

      <div className="grid gap-md lg:grid-cols-[minmax(0,1fr)_360px]">
        <Box title="你自己的使用数据" aside={<span>曝光按 (项目, 会话) 去重</span>}>
          <BoxRow className="flex flex-col gap-xs py-sm">
            <Line k="曝光" v={stats.impressions} note={`触达 ${stats.reach} 个不同项目 · ${stats.sessions} 个会话`} />
            <Line k="点开" v={stats.opens} note={`点开率 ${ctr.toFixed(1)}%`} />
            <Line k="收藏" v={stats.saved} />
            <Line k="不感兴趣" v={stats.hides} />
            {me?.kinds.length ? (
              <div className="mt-xs flex flex-wrap gap-2xs">
                {me.kinds.map(([k, n]) => (
                  <Badge key={k} variant="outline">
                    {k} × {n}
                  </Badge>
                ))}
              </div>
            ) : null}
          </BoxRow>
          {me && me.hide_reasons.length ? (
            <BoxRow className="flex flex-wrap items-center gap-xs py-sm">
              <span className="text-caption text-muted-foreground">不感兴趣的理由：</span>
              {me.hide_reasons.map(([r, n]) => (
                <Badge key={r} variant="secondary">
                  {r} × {n}
                </Badge>
              ))}
            </BoxRow>
          ) : null}
        </Box>

        <Box title="校准就绪度" aside={<span>门槛 n ≥ {me?.min_n ?? 20}</span>}>
          <BoxRow className="flex flex-col gap-xs py-sm">
            <p className="text-body">
              {ready
                ? "曝光条数可能够到了，可以点「重新校准」试试。"
                : "曝光还不够，所以排序仍用的是默认权重。"}
            </p>
            <p className="text-caption text-muted-foreground">
              分桶校准需要每个桶至少 {me?.min_n ?? 20} 条曝光；
              够不到的桶权重强制 1.0，也就是<b>样本不足就不生效</b> —— 几十条数据就改排序等于把噪声当信号。
            </p>
            {me && me.buckets.length ? (
              <div className="mt-xs flex flex-col gap-2xs text-caption">
                {me.buckets.map((b) => (
                  <span key={b.feat + b.bucket} className="flex items-center justify-between gap-sm">
                    <span className="font-mono truncate">
                      {b.feat}={b.bucket}
                    </span>
                    <span className="flex items-center gap-2xs tabular-nums text-muted-foreground">
                      n={b.n}
                      <Badge variant={b.live ? "default" : "outline"}>×{b.w.toFixed(2)}</Badge>
                    </span>
                  </span>
                ))}
                <span className="mt-xs text-muted-foreground">
                  上次校准：{me.fitted_at ? ago(me.fitted_at) : "从未"}
                </span>
              </div>
            ) : (
              <p className="text-caption text-muted-foreground">还没跑过校准。</p>
            )}
          </BoxRow>
        </Box>

        <Box
          title="静默补货"
          aside={
            <span className="flex items-center gap-xs">
              {refill ? `${refill.pool.toLocaleString()} 条候选中` : ""}
              <Badge variant={refill?.enabled ? "default" : "outline"}>{refill?.enabled ? "开启" : "关闭"}</Badge>
            </span>
          }
        >
          <BoxRow className="flex flex-col gap-xs py-sm">
            <p className="text-body">
              后台每 20 分钟自己补一小步（按通道轮转：画像 → 热度 → 探索 → 相似用户），
              <b>不打扰你</b>，也不需要你点任何按钮。抓进来的量远大于展示量——榜上一页 100 条，
              池子里是它的几十倍，所以你什么时候打开都有东西看。
            </p>
            <span className="flex flex-wrap items-center gap-sm text-caption tabular-nums">
              <span>
                池子 <b className="text-foreground">{refill?.pool.toLocaleString() ?? "—"}</b> 条
              </span>
              <span>画像词表 {refill?.profile_terms ?? 0} 个</span>
              <span>相似用户源 {refill?.social_sources ?? 0} 人</span>
              <span>上次补货 {refill?.last.length ? ago(refill.last[0].at) : "从未"}</span>
            </span>
            {refill?.last.length ? (
              <div className="mt-xs flex flex-col gap-2xs text-caption text-muted-foreground">
                {refill.last.map((s) => (
                  <span key={s.at + s.channel} className="flex items-center justify-between gap-sm">
                    <span className="font-mono truncate">
                      #{s.step} {s.channel}
                    </span>
                    <span className="tabular-nums">
                      新增 {s.inserted.toLocaleString()} · 请求 core {s.core_used} / search {s.search_used}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
            <span className="mt-xs">
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  refillNow()
                    .then((r) => {
                      log(`refill 手动 ${r.channel} +${r.inserted}`);
                      return loadRefill();
                    })
                    .then(() => call<Counts>("get_counts").then(setCounts))
                    .catch((e) => log("refill FAIL " + e))
                    .finally(() => setBusy(false));
                }}
              >
                {busy ? "补货中…" : "现在补一轮"}
              </Button>
            </span>
          </BoxRow>
        </Box>

        <Box title="四档通道" aside={<span>库里现在的行数</span>}>
          <Line k="热度" v={counts?.hot ?? 0} row />
          <Line k="画像" v={counts?.profile ?? 0} row />
          <Line k="相似用户" v={counts?.social ?? 0} row />
          <Line k="探索" v={counts?.explore ?? 0} row />
          <Line k="收藏" v={counts?.saved ?? 0} row />
          <Line k="池子总量" v={counts?.pool ?? 0} note="抓进来的都在这，展示的只是其中 100 条" row />
        </Box>

        <Box title="数据在哪">
          <BoxRow className="flex flex-col gap-xs py-sm">
            <p className="text-body">
              全部在本机 <code>{stats.db}</code>，没有任何一条离开这台机器。
            </p>
            <p className="text-caption text-muted-foreground">
              唯一的例外是翻译：开启后被翻译的简介会发给翻译服务。
            </p>
            <p className="text-caption text-muted-foreground">
              当前画像归属：{stats.login ? `@${stats.login}` : "未登录（匿名 60 次/小时）"} · 上次采集{" "}
              {ago(counts?.last_collect)}
            </p>
          </BoxRow>
        </Box>
      </div>
    </div>
  );
}

function Line({ k, v, note, row }: { k: string; v: number; note?: string; row?: boolean }) {
  const body = (
    <>
      <span className="text-label">{k}</span>
      <span className="flex items-baseline gap-xs tabular-nums">
        <b className="text-lead">{v.toLocaleString()}</b>
        {note ? <span className="text-caption text-muted-foreground">{note}</span> : null}
      </span>
    </>
  );
  if (row)
    return (
      <BoxRow className="flex items-center justify-between gap-md py-sm">
        {body}
      </BoxRow>
    );
  return <div className="flex items-center justify-between gap-md">{body}</div>;
}
