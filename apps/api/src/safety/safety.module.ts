import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { SafetyController } from './safety.controller';
import { SafetyService } from './safety.service';

@Module({
  // Only UsersModule (to confirm a block/report target exists) —
  // deliberately not ConnectionsModule; see SafetyService's docblock
  // for why the connection/connectionRequest cleanup on block goes
  // through PrismaService directly instead.
  imports: [UsersModule],
  controllers: [SafetyController],
  providers: [SafetyService],
})
export class SafetyModule {}
