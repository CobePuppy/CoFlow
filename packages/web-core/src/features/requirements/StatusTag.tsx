import { Tag } from 'antd';
import { labels, type Status } from '@coflow/contracts/index.js';
export function StatusTag({ status }: { status: Status }) {
  return (
    <Tag
      bordered={false}
      color={
        status === 'CLOSED'
          ? 'green'
          : status === 'DEVELOPING'
            ? 'blue'
            : status === 'SOLUTION_REVIEW'
              ? 'purple'
              : status === 'TESTING'
                ? 'cyan'
                : 'default'
      }
    >
      {labels[status]}
    </Tag>
  );
}
