export async function parseImportFile(file: File) {
  if (!file.size || file.size > 8 * 1024 * 1024)
    throw Error('请选择8MB以内的非空文件');
  const ext = file.name.split('.').at(-1)?.toLowerCase();
  const data = new Uint8Array(await file.arrayBuffer());
  let text = '',
    warning = '';
  if (ext === 'txt' || ext === 'md') {
    if (data.includes(0)) throw Error('文件不是可读取的纯文本');
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      text = new TextDecoder('gb18030', { fatal: true }).decode(data);
      warning = '按GB18030编码读取，请检查中文是否正确。';
    }
  } else if (ext === 'docx') {
    if (data[0] !== 80 || data[1] !== 75) throw Error('文件内容不是有效的DOCX');
    const { unzipSync } = await import('fflate');
    const entries = unzipSync(data, {
      filter: (entry) => {
        if (entry.name !== 'word/document.xml') return false;
        if (entry.originalSize > 2 * 1024 * 1024)
          throw Error('DOCX正文过大，请拆分后导入');
        return true;
      },
    });
    const document = entries['word/document.xml'];
    if (!document) throw Error('DOCX缺少正文，请重新导出文件');
    const xml = new TextDecoder().decode(document);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('DOCX包含不支持的XML声明');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length)
      throw Error('DOCX正文损坏');
    text = Array.from(doc.getElementsByTagNameNS('*', 'p'))
      .map((p) =>
        Array.from(p.getElementsByTagNameNS('*', 't'))
          .map((t) => t.textContent || '')
          .join(''),
      )
      .join('\n');
    warning = '仅提取正文和表格中的文字；图片、批注与排版不导入，请核对顺序。';
  } else if (ext === 'pdf') {
    if (new TextDecoder().decode(data.slice(0, 5)) !== '%PDF-')
      throw Error('文件内容不是有效的PDF');
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const loading = pdfjs.getDocument({
      data,
      enableXfa: false,
      useWorkerFetch: false,
      disableFontFace: true,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      text = await Promise.race([
        (async () => {
          const pdf = await loading.promise;
          if (pdf.numPages > 80) throw Error('PDF超过80页，请拆分后导入');
          let result = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            result +=
              content.items
                .map((item: any) =>
                  'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '',
                )
                .join('') + '\n';
            if (result.length > 60000)
              throw Error('正文超过6万字符，请拆分后导入');
            page.cleanup();
          }
          return result;
        })(),
        new Promise<string>((_, reject) => {
          timer = setTimeout(
            () => reject(Error('PDF解析超时，请拆分文件后重试')),
            30000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      await loading.destroy();
    }
    warning =
      '仅提取可复制文字；扫描件需先OCR。表格、多栏和公式可能错序，请检查正文。';
  } else
    throw Error('支持TXT、Markdown、DOCX和文字型PDF；旧版DOC、图片请先转换');
  text = text.replace(/\r\n/g, '\n').trim();
  if (!text) throw Error('未提取到正文；扫描件或图片请先OCR后再导入');
  if (text.length > 60000) throw Error('正文超过6万字符，请拆分后导入');
  return { text, warning };
}
