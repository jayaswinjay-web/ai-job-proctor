import { loadDotEnv, loadEnv } from '@proctor/config';
import { createLogger, getPrisma } from '@proctor/database';
import { buildInterviewPlan } from './apps/api/src/services/plan-builder.js';

loadDotEnv();
const env = loadEnv().env;
const logger = createLogger({ level: 'error', isProduction: false, databaseUrl: env.DATABASE_URL, service: 'probe' });
const prisma = getPrisma(logger);

const jobs = await prisma.job.findMany({
  where: { status: 'ACTIVE', deletedAt: null },
  include: { stages: true, questions: { select: { id: true, text: true, stageId: true, isActive: true, sortOrder: true, difficulty: true } } },
  orderBy: { title: 'asc' },
});

for (const job of jobs) {
  console.log('\n===', job.title, '| questions:', job.questions.length, '| stages:', job.stages.map((s) => `${s.kind}:${s.sortOrder}(max ${s.maxQuestions})`).join(', '));
  for (const q of job.questions) {
    console.log('   q:', q.sortOrder, q.difficulty, '| stage:', q.stageId ? job.stages.find((s) => s.id === q.stageId)?.sortOrder : 'null', '|', q.text.slice(0, 50));
  }
  const plan = await buildInterviewPlan(prisma, logger, { jobId: job.id, languageCode: 'en', supportedLanguages: ['en', 'hi', 'mr'] });
  console.log('   -> plan questions:', plan.questions.length, '| details:', plan.details.length, '| eligibility:', plan.eligibility.length);
}

await prisma.$disconnect();