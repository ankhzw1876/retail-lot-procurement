import Link from "next/link";

const FLOW = [
  { title: "看报价与证据", copy: "核对整批件数、尺码和交货条件，再看可比款的可售销量与缺货记录。" },
  { title: "算价与压力", copy: "比较三种销售情景，反推最高进货价，看悲观情景离贡献目标还有多远。" },
  { title: "检查门店去向", copy: "按尺码核对门店缺口、现有库存和承接容量，明确哪些件数可能留仓。" },
  { title: "保存决定并复盘", copy: "留存当时的报价与假设。卖完后把实际结果和原计划逐项对照。" },
];

export default function Home() {
  return (
    <div className="demo-home">
      <section className="demo-hero" aria-labelledby="demo-title">
        <div className="demo-hero-copy">
          <p className="demo-eyebrow">折扣零售 · 品牌尾货采购</p>
          <h1 id="demo-title">这批货，多少钱能接？</h1>
          <p className="demo-intro">
            用一张供应商整批报价单，走完采购评估、门店分配和期末复盘。
            你可以自己改报价、改销量假设，看看哪条条件会改变决定。
          </p>
          <div className="demo-actions">
            <Link className="btn primary" href="/opportunities/LOT-B">开始云杉卫衣案例</Link>
            <Link className="btn" href="/opportunities">查看采购机会</Link>
          </div>
        </div>
        <aside className="demo-quote" aria-label="云杉卫衣样例报价">
          <p className="demo-eyebrow">内置案例 · LOT-B</p>
          <h2>云杉运动卫衣</h2>
          <dl>
            <div><dt>整批货量</dt><dd className="num">1,000 <span>件</span></dd></div>
            <div><dt>初始报价</dt><dd className="num">60 <span>元 / 件</span></dd></div>
          </dl>
          <p>这笔报价能否达到目标？先在详情页看证据，再进入「情景测算」。</p>
        </aside>
      </section>

      <section className="demo-flow" aria-labelledby="demo-flow-title">
        <h2 id="demo-flow-title">一笔采购怎么走完</h2>
        <ol>
          {FLOW.map(({ title, copy }) => (
            <li key={title}><h3>{title}</h3><p>{copy}</p></li>
          ))}
        </ol>
      </section>
    </div>
  );
}
