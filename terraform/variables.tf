variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "ap-south-1"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.micro"
}

variable "key_name" {
  description = "Name of the AWS EC2 key pair for SSH access"
  type        = string
}

variable "project_name" {
  description = "Project name used for resource naming and tagging"
  type        = string
  default     = "myraid-assessment"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "assessment"
}

variable "s3_bucket_suffix" {
  description = "Unique suffix appended to S3 bucket name — S3 names are globally unique across all AWS accounts"
  type        = string
  default     = "001"
}
