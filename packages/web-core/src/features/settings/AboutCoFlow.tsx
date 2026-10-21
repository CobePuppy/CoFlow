import { Card, Collapse, Descriptions, Empty, Space, Tag } from 'antd';
import info from 'virtual:coflow-product-info';
import { BrandMark } from '../../shared/ui/BrandMark.js';
import { edition } from '../../app/edition.js';
import './about.css';
const labels: Record<string, string> = {
  frontend: '前端',
  backend: '后端',
  feature: '功能',
  maintenance: '维护',
};
export default function AboutCoFlow() {
  return (
    <section className="about-coflow" aria-label="关于汇流">
      <Card>
        <BrandMark />
        <h2>关于汇流</h2>
        <p>汇流 CoFlow，让需求、协作与交付有迹可循。</p>
        <Descriptions
          column={{ xs: 1, sm: 2 }}
          items={[
            {
              key: 'product',
              label: '当前应用版本',
              children: <strong>v{info.product}</strong>,
            },
            { key: 'edition', label: '当前界面', children: edition.label },
            { key: 'web', label: '前端组件', children: info.web },
            { key: 'api', label: '配套后端组件', children: info.api },
          ]}
        />
      </Card>
      <Card title="更新历史">
        <p className="muted">
          查看此版本随附的更新记录，展开版本了解更新详情。日期为版本登记日期。
        </p>
        {info.history.length ? (
          <Collapse
            defaultActiveKey={[info.product]}
            items={info.history.map((release) => ({
              key: release.version,
              label: (
                <Space wrap>
                  <strong>v{release.version}</strong>
                  <span>{release.date}</span>
                  {release.version === info.product && (
                    <Tag color="green">当前版本</Tag>
                  )}
                </Space>
              ),
              children: (
                <>
                  <Space wrap>
                    {release.categories.map((c) => (
                      <Tag key={c}>{labels[c] || c}</Tag>
                    ))}
                  </Space>
                  <h3>更新详情</h3>
                  {release.changes.length ? (
                    <ul>
                      {release.changes.map((change, i) => (
                        <li key={i}>{change}</li>
                      ))}
                    </ul>
                  ) : (
                    <Empty description="此版本暂无详细记录" />
                  )}
                </>
              ),
            }))}
          />
        ) : (
          <Empty description="暂无更新记录" />
        )}
      </Card>
    </section>
  );
}
