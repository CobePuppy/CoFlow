import type { ThemeConfig } from 'antd';
import type { edition as currentEdition } from './edition.js';
export function editionTheme(edition: typeof currentEdition): ThemeConfig {
  return {
    token: {
      colorPrimary: edition.primary,
      colorLink: edition.primary,
      colorInfo: edition.primary,
      colorInfoBg: edition.id === 'student' ? '#e1f4ee' : '#eaf3ff',
      colorInfoBgHover: edition.id === 'student' ? '#d2ede4' : '#ddeaff',
      colorInfoBorder: edition.id === 'student' ? '#a6d8cb' : '#b8d2f4',
      colorInfoBorderHover: edition.id === 'student' ? '#7fc1b1' : '#8fb8ec',
      colorInfoText: edition.id === 'student' ? '#245951' : '#244e7c',
      fontSize: 14,
      borderRadius: 8,
      controlHeight: 36,
      colorText: '#202633',
      colorTextSecondary: '#626d80',
      colorBorder: '#e0e4eb',
      colorBorderSecondary: '#e9ecf1',
      fontFamily: '"Noto Sans SC", "Microsoft YaHei", sans-serif',
      colorBgLayout: edition.id === 'student' ? '#f6f9f8' : '#f7f8fa',
    },
    ...(edition.id === 'student'
      ? {
          components: {
            Button: { primaryShadow: '0 2px 5px rgba(8,127,121,0.16)' },
            Card: { headerBg: '#ffffff' },
            Table: { headerBg: '#f6f9f7', rowHoverBg: '#edf7f3' },
            Tabs: { itemSelectedColor: '#087f79', inkBarColor: '#087f79' },
          },
        }
      : {
          components: {
            Button: { primaryShadow: '0 2px 5px rgba(20,105,216,0.16)' },
            Card: { headerBg: '#ffffff' },
            Table: { headerBg: '#f7f8fa', rowHoverBg: '#f0f6ff' },
            Tabs: { itemSelectedColor: '#1469d8', inkBarColor: '#1469d8' },
          },
        }),
  };
}
