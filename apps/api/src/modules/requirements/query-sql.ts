import { Prisma } from '@prisma/client';
// Same responsibility rules as the domain; review slots already filled no longer wait for that reviewer.
export const handling = (user: string) => Prisma.sql`(CASE
 WHEN status IN ('DRAFT','ACCEPTANCE_PENDING') THEN data->>'productId' = ${user}
 WHEN status IN ('READY_FOR_TEST','TESTING') THEN data->>'testerId' = ${user}
 WHEN status = 'SOLUTION_REVIEW' THEN (${user} = ANY(ARRAY[data->>'productReviewerId',data->>'qaReviewerId']) AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(data->'reviews','[]'::jsonb)) r WHERE r->>'userId' = ${user} AND (r->>'round')::int = jsonb_array_length(COALESCE(data->'solutions','[]'::jsonb))))
 ELSE data->>'engineerId' = ${user} END)`;
