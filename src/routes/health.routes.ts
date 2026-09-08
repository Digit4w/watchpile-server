import { createRoute, z } from '@hono/zod-openapi'

const HealthResponseSchema = z.object({
  status: z.literal('ok'),
})

export const healthCheck = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Health'],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: HealthResponseSchema,
        },
      },
      description: 'The server is up',
    },
  },
})

export type HealthCheckRoute = typeof healthCheck
