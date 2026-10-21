import { Select, Tag } from 'antd';

export function TeamSwitcher({
  teams,
  value,
  onChange,
  loading,
}: {
  teams: any[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
}) {
  const current = teams.find((team) => team.id === value);
  return (
    <div className="team-switcher">
      <div className="team-switcher-heading">
        <span>当前团队</span>
        {current && (
          <span className="team-switcher-role">
            {current.role === 'ADMIN' ? '管理员' : '成员'}
          </span>
        )}
      </div>
      <Select
        className="workspace-select"
        aria-label="切换团队"
        value={current ? value : undefined}
        loading={loading}
        placeholder="选择团队"
        popupMatchSelectWidth={280}
        options={teams.map((team) => ({
          value: team.id,
          label: `${team.name} · ${team.role === 'ADMIN' ? '管理员' : '成员'}`,
          name: team.name,
          role: team.role,
        }))}
        labelRender={() => (
          <span className="team-switcher-name" title={current?.name}>
            {current?.name}
          </span>
        )}
        optionRender={(option) => (
          <div className="team-switcher-option">
            <span title={option.data.name}>{option.data.name}</span>
            <Tag>{option.data.role === 'ADMIN' ? '管理员' : '成员'}</Tag>
          </div>
        )}
        onChange={onChange}
      />
    </div>
  );
}
