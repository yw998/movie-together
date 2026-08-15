type ProductGuideProps = {
  open: boolean;
  onClose: () => void;
  onCreateGroup: () => void;
};

export function ProductGuide({ open, onClose, onCreateGroup }: ProductGuideProps) {
  if (!open) return null;

  return <div className="product-guide-backdrop" role="presentation" onMouseDown={onClose}>
    <section aria-labelledby="product-guide-title" aria-modal="true" className="product-guide" onMouseDown={(event) => event.stopPropagation()} role="dialog">
      <button aria-label="关闭如何使用" className="product-guide-close" onClick={onClose} type="button">×</button>
      <span className="eyebrow dark">HOW IT WORKS</span>
      <h2 id="product-guide-title">一起决定这周看什么</h2>
      <p className="product-guide-lead">观影小组是只有受邀成员可见的共享空间。</p>
      <ol className="product-steps">
        <li><b>浏览排片</b><span>查看纽约艺术影院未来七天的放映。</span></li>
        <li><b>建立小组</b><span>创建或加入一个私人观影小组。</span></li>
        <li><b>标记想看</b><span>选择电影、影院、日期和时间都确定的场次。</span></li>
        <li><b>一起查看</b><span>在小组里看到朋友共同想看的时间。</span></li>
      </ol>
      <div className="identity-comparison">
        <article>
          <h3>个人账号</h3>
          <p>适合长期使用。想看默认仅自己可见，再选择分享给一个或多个观影小组。</p>
          <ul><li>可加入多个小组</li><li>邮箱可用于找回账号</li><li>集中查看邀请和小组动态</li></ul>
        </article>
        <article>
          <h3>小组身份 <small>无需邮箱</small></h3>
          <p>适合先加入一个固定小组。所有想看都会直接分享给该小组。</p>
          <ul><li>只能绑定同一个小组</li><li>个人代码丢失后无法找回</li><li>以后可升级为个人账号并保留内容</li></ul>
        </article>
      </div>
      <p className="product-guide-note">已有多个小组身份？升级后可逐个连接，保留加入过的小组、角色和想看。</p>
      <button className="product-guide-cta" onClick={() => { onClose(); onCreateGroup(); }} type="button">创建观影小组</button>
    </section>
  </div>;
}
