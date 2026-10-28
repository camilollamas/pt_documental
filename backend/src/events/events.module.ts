import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentEntity } from '../documents/document.entity.js';
import { EventsController } from './events.controller.js';
import { StatusStream } from './status-stream.service.js';

/** Lado API: SSE alimentado por Redis Pub/Sub. El worker usa StatusPublisher por separado. */
@Module({
  imports: [TypeOrmModule.forFeature([DocumentEntity])],
  controllers: [EventsController],
  providers: [StatusStream],
})
export class EventsModule {}
