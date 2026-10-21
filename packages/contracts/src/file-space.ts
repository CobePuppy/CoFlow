export const fileTypes = [
  { value: 'ALL', label: '全部类型', mimes: [] },
  {
    value: 'TEXT',
    label: '文本与规范',
    mimes: ['text/plain', 'text/markdown'],
  },
  { value: 'IMAGE', label: '图片', mimes: ['image/png', 'image/jpeg'] },
  { value: 'PDF', label: 'PDF', mimes: ['application/pdf'] },
  {
    value: 'OFFICE',
    label: 'Office 文档',
    mimes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
  },
  { value: 'ARCHIVE', label: '压缩包', mimes: ['application/zip'] },
];
export const fileSorts = [
  { value: 'newest', label: '最近上传' },
  { value: 'updated', label: '最近更新' },
  { value: 'name', label: '名称顺序' },
  { value: 'size', label: '文件从大到小' },
];
export function fileSpaceState(params: URLSearchParams) {
  return {
    type:
      fileTypes.find((t) => t.value === params.get('fileType'))?.value || 'ALL',
    sort:
      fileSorts.find((t) => t.value === params.get('fileSort'))?.value ||
      'newest',
    uploader: params.get('fileUploader') === 'MINE' ? 'MINE' : 'ALL',
  };
}
