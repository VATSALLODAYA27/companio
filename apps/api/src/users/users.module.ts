import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

// Deliberately does NOT import AuthModule — SessionAuthGuard lives in
// src/common so both AuthModule and UsersModule can depend on it without
// a circular import (AuthModule already depends on UsersModule for
// UsersService).
@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
