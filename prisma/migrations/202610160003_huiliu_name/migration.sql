-- Only rename unchanged local demo workspace/project names. Preserve user-edited names and all task history.
UPDATE "Workspace" SET name='汇流 产品团队' WHERE id='00000000-0000-4000-8000-000000000001' AND name='CoFlow 产品团队';
UPDATE "Project" SET name='汇流 协作平台' WHERE id='10000000-0000-4000-8000-000000000001' AND name='CoFlow 协作平台';
