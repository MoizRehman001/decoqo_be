import { Module } from '@nestjs/common';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { ProjectStateService } from './project-state.service';

@Module({
  controllers: [ProjectController],
  providers: [ProjectService, ProjectStateService],
  exports: [ProjectService, ProjectStateService],
})
export class ProjectModule {}
