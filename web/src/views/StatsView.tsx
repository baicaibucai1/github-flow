import { Progress } from "@soda/ui";
import { DashboardPage, PanelCard } from "@soda/patterns";
import { call, log, type Counts } from "../lib/bridge";
import { useApp } from "../lib/store";
import { useEffect, useState } from "react";

/** 统计页只报本机行为计数，不做任何"预测"。校准门槛 n>=20 直接写在这里，
    免得看的人以为几百条数据就能改排序。 */
export function StatsView() {
  const { stats } = useApp();
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    void call<Counts>("get_counts")
      .then(setCounts)
      .catch((e) => log("counts FAIL " + e));
  }, []);

  if (!stats) {
    return <div className="p-md text-body text-muted-foreground">读不到统计</div>;
  }

  const ctr = Math.round((stats.opens / Math.max(stats.impressions, 1)) * 1000) / 10;
  const ready = stats.impressions >= 100;

  return (
    <div className="p-md">
      <DashboardPage
        header={{
          title: "统计",
          description: "这些数字全部来自你在本机的行为，没有任何一条离开这台机器。",
        }}
        metrics={[
          { label: "候选池", value: stats.pool.toLocaleString() },
          { label: "已测增速", value: stats.ranked.toLocaleString() },
          { label: "曝光", value: stats.impressions.toLocaleString() },
          { label: "点开率", value: `${ctr}%` },
        ]}
      >
        <PanelCard
          title="你自己的使用数据"
          description="触达 = 去重后的不同项目数；跨会话的重复展示已被 (repo_id, session) 去重。"
          span={8}
        >
          <div className="flex flex-col gap-md">
            <Bar label="曝光" v={stats.impressions} max={Math.max(stats.impressions, 1)} />
            <Bar label="点开" v={stats.opens} max={Math.max(stats.impressions, 1)} />
            <Bar label="收藏" v={stats.saved} max={Math.max(stats.impressions, 1)} />
            <Bar label="不感兴趣" v={stats.hides} max={Math.max(stats.impressions, 1)} />
          </div>
          <p className="mt-md text-caption text-muted-foreground">
            触达 {stats.reach} 个不同项目 / {stats.sessions} 个会话；收藏 {stats.saved} 个；
            标记不感兴趣 {stats.hides} 个。
          </p>
          <p className="text-caption text-muted-foreground">
            校准需要每个桶至少 20 条曝光：现在
            {ready ? "可能已经够了，可以点「重新校准」" : "还不够，所以排序仍用的是默认权重"}。
          </p>
        </PanelCard>

        <PanelCard title="四档通道" description="取数与排序都在 Rust 侧，这里只是把库里的行数念出来。" span={4}>
          <div className="flex flex-col gap-sm text-label">
            <Line k="热度" v={counts?.hot ?? 0} />
            <Line k="画像" v={counts?.profile ?? 0} />
            <Line k="探索" v={counts?.explore ?? 0} />
            <Line k="收藏" v={counts?.saved ?? 0} />
            <Line k="有增速数据" v={counts?.all ?? 0} />
          </div>
        </PanelCard>

        <PanelCard title="数据在哪" span={6}>
          <p className="text-caption">
            全部在本机 <code>{stats.db}</code>。
            唯一的例外是翻译：开启后被翻译的简介会发给翻译服务。
          </p>
        </PanelCard>

        <PanelCard title="身份与配额" span={6}>
          <p className="text-caption">
            当前画像归属：{stats.login ? `@${stats.login}` : "未登录（匿名 60 次/小时）"}
            <br />
            上次采集：{relTime0(counts?.last_collect)}
          </p>
        </PanelCard>
      </DashboardPage>
    </div>
  );
}

function Bar({ label, v, max }: { label: string; v: number; max: number }) {
  return (
    <div className="flex flex-col gap-2xs">
      <div className="flex items-center justify-between text-label">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">{v.toLocaleString()}</span>
      </div>
      <Progress value={(v / max) * 100} />
    </div>
  );
}

function Line({ k, v }: { k: string; v: number }) {
  return (
    <span className="flex items-center justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className="tabular-nums">{v.toLocaleString()}</span>
    </span>
  );
}

function relTime0(ts: number | undefined): string {
  if (!ts) return "从未";
  const m = Math.round((Date.now() / 1000 - ts) / 60);
  if (m < 60) return `${m} 分钟前`;
  if (m < 1440) return `${Math.round(m / 60)} 小时前`;
  return `${Math.round(m / 1440)} 天前`;
}
