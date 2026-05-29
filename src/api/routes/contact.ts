import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { successResponse } from '@/shared/utils';
import { promises as fs } from 'fs';
import path from 'path';

const ContactFormSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(200),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
});

const SUBMISSIONS_FILE = path.join(process.cwd(), 'data', 'contact-submissions.json');

async function persistSubmission(submission: Record<string, unknown>): Promise<void> {
  try {
    const dir = path.dirname(SUBMISSIONS_FILE);
    await fs.mkdir(dir, { recursive: true });

    let existing: Record<string, unknown>[] = [];
    try {
      const raw = await fs.readFile(SUBMISSIONS_FILE, 'utf-8');
      existing = JSON.parse(raw);
    } catch {
      // File doesn't exist yet
    }
    existing.push(submission);
    await fs.writeFile(SUBMISSIONS_FILE, JSON.stringify(existing, null, 2));
  } catch (err) {
    console.error('[Contact] Failed to persist submission:', err);
  }
}

export async function contactRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /contact/submit — receive and persist a contact form submission
  fastify.post('/submit', async (request, reply) => {
    const body = ContactFormSchema.parse(request.body);

    const submission = {
      id: crypto.randomUUID(),
      ...body,
      status: 'unread',
      submittedAt: new Date().toISOString(),
    };

    console.log('[Contact Form]', {
      name: body.name,
      email: body.email,
      subject: body.subject,
      messageLength: body.message.length,
    });

    // Persist to disk so submissions survive restarts
    await persistSubmission(submission);

    return reply.send(successResponse({
      received: true,
      message: 'Thank you for reaching out! We will get back to you soon.',
    }));
  });

  // GET /contact/submissions — admin view of all contact submissions
  fastify.get('/submissions', async (request, reply) => {
    try {
      const raw = await fs.readFile(SUBMISSIONS_FILE, 'utf-8');
      const submissions = JSON.parse(raw);
      return reply.send(successResponse(submissions));
    } catch {
      return reply.send(successResponse([]));
    }
  });
}
