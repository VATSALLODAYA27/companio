import { ActivitiesService } from './activities.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ActivitiesService', () => {
  let prisma: jest.Mocked<Pick<PrismaService, 'activity'>>;
  let service: ActivitiesService;

  beforeEach(() => {
    prisma = { activity: { findMany: jest.fn() } } as unknown as jest.Mocked<
      Pick<PrismaService, 'activity'>
    >;
    service = new ActivitiesService(prisma as unknown as PrismaService);
  });

  it('findAll orders by label and selects only public fields', async () => {
    (prisma.activity.findMany as jest.Mock).mockResolvedValue([
      { id: '1', key: 'bowling', label: 'Bowling' },
    ]);

    await service.findAll();

    expect(prisma.activity.findMany).toHaveBeenCalledWith({
      orderBy: { label: 'asc' },
      select: { id: true, key: true, label: true },
    });
  });

  it('findIdsByKeys returns an empty map without querying when given no keys', async () => {
    const result = await service.findIdsByKeys([]);
    expect(result.size).toBe(0);
    expect(prisma.activity.findMany).not.toHaveBeenCalled();
  });

  it('findIdsByKeys maps each key to its id', async () => {
    (prisma.activity.findMany as jest.Mock).mockResolvedValue([
      { id: 'a1', key: 'gym' },
      { id: 'a2', key: 'running' },
    ]);

    const result = await service.findIdsByKeys(['gym', 'running']);

    expect(result.get('gym')).toBe('a1');
    expect(result.get('running')).toBe('a2');
    expect(result.has('cricket')).toBe(false);
  });
});
