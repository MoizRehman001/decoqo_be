import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AddRoomDto } from './dto/add-room.dto';
import { SetBudgetDto } from './dto/set-budget.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('projects')
@ApiBearerAuth('access-token')
@Controller({ path: 'projects', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Post()
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new project' })
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: JwtPayload) {
    return this.projectService.create(dto, user.sub);
  }

  @Get()
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'List own projects' })
  findAll(@CurrentUser() user: JwtPayload, @Query() pagination: PaginationDto) {
    return this.projectService.findAll(user.sub, pagination);
  }

  @Get('available')
  @Roles(UserRole.VENDOR)
  @ApiOperation({ summary: 'List projects available for bidding (vendor)' })
  findAvailable(@CurrentUser() user: JwtPayload, @Query() pagination: PaginationDto) {
    return this.projectService.findAvailable(user.sub, pagination);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project detail' })
  findById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.projectService.findById(id, user.sub, user.role as UserRole);
  }

  @Patch(':id')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Update project (DRAFT only)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel project (DRAFT only)' })
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.projectService.cancel(id, user.sub);
  }

  @Post(':id/rooms')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add room to project' })
  addRoom(
    @Param('id') id: string,
    @Body() dto: AddRoomDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectService.addRoom(id, dto, user.sub);
  }

  @Patch(':id/rooms/:roomId')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Update room' })
  updateRoom(
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() dto: AddRoomDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectService.updateRoom(id, roomId, dto, user.sub);
  }

  @Delete(':id/rooms/:roomId')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove room' })
  removeRoom(
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectService.removeRoom(id, roomId, user.sub);
  }

  @Post(':id/budget')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set budget and timeline' })
  setBudget(
    @Param('id') id: string,
    @Body() dto: SetBudgetDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectService.setBudget(id, dto, user.sub);
  }

  @Post(':id/publish')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish project for bidding' })
  publish(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.projectService.publish(id, user.sub);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Get trust timeline for project' })
  getTimeline(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.projectService.getTimeline(id, user.sub, user.role as UserRole);
  }
}
