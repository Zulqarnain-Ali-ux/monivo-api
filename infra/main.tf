terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  # Replace with your own S3 backend once created
  backend "s3" {
    bucket         = "monivo-terraform-state"
    key            = "api/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "monivo-terraform-locks"
  }
}

provider "aws" {
  region = var.aws_region
  default_tags { tags = { Project = "monivo", Env = var.environment } }
}

# ── Variables ──────────────────────────────────────────────────────
variable "aws_region"        { default = "us-east-1" }
variable "environment"       { default = "production" }
variable "db_password"       { sensitive = true }
variable "jwt_secret"        { sensitive = true }
variable "jwt_refresh_secret"{ sensitive = true }
variable "plaid_client_id"   { sensitive = true }
variable "plaid_secret"      { sensitive = true }
variable "api_image_tag"     { default = "latest" }

locals {
  name   = "monivo-${var.environment}"
  prefix = "monivo"
}

# ── Networking: VPC ────────────────────────────────────────────────
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = { Name = "${local.name}-vpc" }
}

resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags = { Name = "${local.name}-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags = { Name = "${local.name}-private-${count.index}" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-igw" }
}

resource "aws_eip" "nat" { domain = "vpc" }

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  depends_on    = [aws_internet_gateway.main]
  tags          = { Name = "${local.name}-nat" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route { cidr_block = "0.0.0.0/0"; gateway_id = aws_internet_gateway.main.id }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route { cidr_block = "0.0.0.0/0"; nat_gateway_id = aws_nat_gateway.main.id }
}

resource "aws_route_table_association" "public"  { count = 2; subnet_id = aws_subnet.public[count.index].id;  route_table_id = aws_route_table.public.id }
resource "aws_route_table_association" "private" { count = 2; subnet_id = aws_subnet.private[count.index].id; route_table_id = aws_route_table.private.id }

data "aws_availability_zones" "available" {}

# ── KMS key for Plaid token encryption ────────────────────────────
resource "aws_kms_key" "monivo" {
  description             = "MONIVO Plaid token encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}
resource "aws_kms_alias" "monivo" {
  name          = "alias/${local.prefix}-plaid-tokens"
  target_key_id = aws_kms_key.monivo.key_id
}

# ── ECR repository ─────────────────────────────────────────────────
resource "aws_ecr_repository" "api" {
  name                 = "${local.prefix}-api"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection    = { tagStatus = "any"; countType = "imageCountMoreThan"; countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

# ── RDS PostgreSQL ─────────────────────────────────────────────────
resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_security_group" "rds" {
  name   = "${local.name}-rds"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }
}

resource "aws_db_instance" "postgres" {
  identifier             = "${local.name}-postgres"
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = "db.t4g.micro"
  allocated_storage      = 20
  max_allocated_storage  = 100
  storage_encrypted      = true
  db_name                = "monivo"
  username               = "monivo"
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  backup_retention_period = 7
  deletion_protection    = true
  skip_final_snapshot    = false
  final_snapshot_identifier = "${local.name}-final"
  multi_az               = true
}

# ── ElastiCache Redis ──────────────────────────────────────────────
resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name}-redis"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_security_group" "redis" {
  name   = "${local.name}-redis"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "${local.name}-redis"
  engine               = "redis"
  node_type            = "cache.t4g.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  engine_version       = "7.0"
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]
}

# ── Secrets Manager ────────────────────────────────────────────────
resource "aws_secretsmanager_secret" "api_secrets" {
  name                    = "monivo/api/${var.environment}"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "api_secrets" {
  secret_id = aws_secretsmanager_secret.api_secrets.id
  secret_string = jsonencode({
    JWT_SECRET         = var.jwt_secret
    JWT_REFRESH_SECRET = var.jwt_refresh_secret
    DB_PASSWORD        = var.db_password
    PLAID_CLIENT_ID    = var.plaid_client_id
    PLAID_SECRET       = var.plaid_secret
  })
}

# ── ECS Cluster ────────────────────────────────────────────────────
resource "aws_ecs_cluster" "main" {
  name = "${local.name}-cluster"
  setting { name = "containerInsights"; value = "enabled" }
}

resource "aws_security_group" "ecs_tasks" {
  name   = "${local.name}-ecs-tasks"
  vpc_id = aws_vpc.main.id
  egress { from_port = 0; to_port = 0; protocol = "-1"; cidr_blocks = ["0.0.0.0/0"] }
  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name = "${local.name}-ecs-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow"; Principal = { Service = "ecs-tasks.amazonaws.com" }; Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_exec_policy" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name = "${local.name}-ecs-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow"; Principal = { Service = "ecs-tasks.amazonaws.com" }; Action = "sts:AssumeRole" }]
  })
  inline_policy {
    name = "monivo-task-policy"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        { Effect = "Allow"; Action = ["kms:Encrypt","kms:Decrypt","kms:GenerateDataKey"]; Resource = aws_kms_key.monivo.arn },
        { Effect = "Allow"; Action = ["ses:SendEmail","ses:SendRawEmail"]; Resource = "*" },
        { Effect = "Allow"; Action = "secretsmanager:GetSecretValue"; Resource = aws_secretsmanager_secret.api_secrets.arn },
      ]
    })
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name}-api"
  retention_in_days = 30
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "api"
    image     = "${aws_ecr_repository.api.repository_url}:${var.api_image_tag}"
    essential = true
    portMappings = [{ containerPort = 3000; protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV";        value = "production" },
      { name = "PORT";            value = "3000" },
      { name = "DB_HOST";         value = aws_db_instance.postgres.address },
      { name = "DB_PORT";         value = "5432" },
      { name = "DB_NAME";         value = "monivo" },
      { name = "DB_USER";         value = "monivo" },
      { name = "DB_SSL";          value = "true" },
      { name = "REDIS_HOST";      value = aws_elasticache_cluster.redis.cache_nodes[0].address },
      { name = "REDIS_PORT";      value = "6379" },
      { name = "AWS_REGION";      value = var.aws_region },
      { name = "AWS_KMS_KEY_ID";  value = aws_kms_key.monivo.key_id },
      { name = "PLAID_ENV";       value = "production" },
      { name = "SES_REGION";      value = var.aws_region },
    ]
    secrets = [
      { name = "JWT_SECRET";          valueFrom = "${aws_secretsmanager_secret.api_secrets.arn}:JWT_SECRET::" },
      { name = "JWT_REFRESH_SECRET";  valueFrom = "${aws_secretsmanager_secret.api_secrets.arn}:JWT_REFRESH_SECRET::" },
      { name = "DB_PASSWORD";         valueFrom = "${aws_secretsmanager_secret.api_secrets.arn}:DB_PASSWORD::" },
      { name = "PLAID_CLIENT_ID";     valueFrom = "${aws_secretsmanager_secret.api_secrets.arn}:PLAID_CLIENT_ID::" },
      { name = "PLAID_SECRET";        valueFrom = "${aws_secretsmanager_secret.api_secrets.arn}:PLAID_SECRET::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "api"
      }
    }
    healthCheck = {
      command     = ["CMD-SHELL","wget -qO- http://localhost:3000/health/live || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 15
    }
  }])
}

# ── Application Load Balancer ──────────────────────────────────────
resource "aws_security_group" "alb" {
  name   = "${local.name}-alb"
  vpc_id = aws_vpc.main.id
  ingress { from_port = 80;  to_port = 80;  protocol = "tcp"; cidr_blocks = ["0.0.0.0/0"] }
  ingress { from_port = 443; to_port = 443; protocol = "tcp"; cidr_blocks = ["0.0.0.0/0"] }
  egress  { from_port = 0;   to_port = 0;   protocol = "-1";  cidr_blocks = ["0.0.0.0/0"] }
}

resource "aws_lb" "main" {
  name               = "${local.name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name}-api"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"
  health_check {
    path                = "/health/live"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect { port = "443"; protocol = "HTTPS"; status_code = "HTTP_301" }
  }
}

# HTTPS listener — add ACM cert ARN after domain setup
# resource "aws_lb_listener" "https" { ... }

# ── ECS Service ────────────────────────────────────────────────────
resource "aws_ecs_service" "api" {
  name            = "${local.name}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  deployment_circuit_breaker { enable = true; rollback = true }

  lifecycle { ignore_changes = [desired_count] }
}

# ── Auto-scaling ────────────────────────────────────────────────────
resource "aws_appautoscaling_target" "api" {
  max_capacity       = 10
  min_capacity       = 2
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${local.name}-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  target_tracking_scaling_policy_configuration {
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
    target_value = 70.0
  }
}

# ── Outputs ────────────────────────────────────────────────────────
output "alb_dns"         { value = aws_lb.main.dns_name }
output "ecr_url"         { value = aws_ecr_repository.api.repository_url }
output "db_endpoint"     { value = aws_db_instance.postgres.endpoint }
output "redis_endpoint"  { value = aws_elasticache_cluster.redis.cache_nodes[0].address }
output "kms_key_id"      { value = aws_kms_key.monivo.key_id }
