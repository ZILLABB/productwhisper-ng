import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { successResponse } from '@/shared/utils';

const ContactFormSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(200),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
});

export async function contactRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/submit', async (request, reply) => {
    const body = ContactFormSchema.parse(request.body);

    // Log the contact form submission
    console.log('[Contact Form]', {
      name: body.name,
      email: body.email,
      subject: body.subject,
      messageLength: body.message.length,
      timestamp: new Date().toISOString(),
    });

    // In production, this would send an email or store in DB
    // For now, we acknowledge receipt
    return reply.send(successResponse({
      received: true,
      message: 'Thank you for reaching out! We will get back to you soon.',
    }));
  });
}
