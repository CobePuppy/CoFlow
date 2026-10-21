import { Card } from 'antd';
export function EditionChoice() {
  return (
    <main className="edition-choice">
      <h1>欢迎使用 CoFlow 汇流</h1>
      <p>选择本次使用场景，登录后可在设置中保存默认版本。</p>
      <div>
        <Card title="企业协作">
          <p>需求、方案评审、研发交付与团队知识。</p>
          <a className="action-link" href="/enterprise/">
            进入企业版
          </a>
        </Card>
        <Card title="学生项目">
          <p>项目协作、竞赛准备、文书与成果整理。</p>
          <a className="action-link" href="/student/">
            进入学生版
          </a>
        </Card>
      </div>
    </main>
  );
}
